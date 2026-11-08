import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Appointment } from "@/lib/api";
import { clamp, endMinutes, layoutDay, minutesOf, timeDateAt, type EventPosition } from "@/lib/calendar";
import { displayDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

// Fixed scale, so a 30-minute appointment stays readable at any slot length.
const PIXELS_PER_MINUTE = 32 / 30;
const GUTTER_WIDTH = 56;
const MIN_BLOCK_HEIGHT = 20;
const DRAG_THRESHOLD = 4;

type Preview = { id: number; timeDate: string; duration: number };
type MenuTarget =
  | { kind: "slot"; timeDate: string }
  | { kind: "appointment"; appointment: Appointment };

function hourLabel(minutes: number): string {
  return `${String(minutes / 60).padStart(2, "0")}:00`;
}

export function WeekGrid({
  days,
  start,
  end,
  slotMinutes,
  workingDays,
  today,
  appointments,
  onCreate,
  onEdit,
  onDelete,
  onReschedule,
}: {
  days: string[];
  start: number;
  end: number;
  slotMinutes: number;
  workingDays: Set<string>;
  today: string;
  appointments: Appointment[];
  onCreate: (timeDate: string) => void;
  onEdit: (appointment: Appointment) => void;
  onDelete: (appointment: Appointment) => void;
  onReschedule: (appointment: Appointment, timeDate: string, duration: number) => void;
}) {
  const { t, language } = useI18n();
  const daysRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);

  const pixelsPerMinute = PIXELS_PER_MINUTE;
  const rowHeight = slotMinutes * pixelsPerMinute;
  const slotCount = (end - start) / slotMinutes;
  const totalHeight = slotCount * rowHeight;
  const hours: number[] = [];
  for (let minutes = start; minutes < end; minutes += 60) hours.push(minutes);

  const locale = language === "ro" ? "ro-RO" : "en-GB";
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });

  const shown = useMemo(
    () =>
      appointments.map((appointment) =>
        appointment.appointmentId === preview?.id
          ? { ...appointment, timeDate: preview.timeDate, duration: preview.duration }
          : appointment,
      ),
    [appointments, preview],
  );

  const positions = useMemo(() => {
    const all = new Map<number, EventPosition>();
    for (const day of days) {
      const events = shown
        .filter((item) => item.timeDate.startsWith(day))
        .map((item) => ({
          id: item.appointmentId,
          start: minutesOf(item.timeDate),
          end: endMinutes(item),
        }));
      for (const [id, position] of layoutDay(events)) all.set(id, position);
    }
    return all;
  }, [days, shown]);

  function pointerAt(event: { clientX: number; clientY: number }) {
    const rect = (daysRef.current as HTMLDivElement).getBoundingClientRect();
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * days.length);
    return {
      day: days[clamp(index, 0, days.length - 1)],
      minutes: start + (event.clientY - rect.top) / pixelsPerMinute,
    };
  }

  const snap = (minutes: number) => Math.round(minutes / slotMinutes) * slotMinutes;

  function beginDrag(
    event: ReactPointerEvent,
    appointment: Appointment,
    mode: "move" | "resize",
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();

    const origin = { x: event.clientX, y: event.clientY };
    const initialStart = minutesOf(appointment.timeDate);
    const grabOffset = pointerAt(event).minutes - initialStart;
    let current: Omit<Preview, "id"> | null = null;

    const onMove = (move: PointerEvent) => {
      if (!current && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_THRESHOLD) {
        return;
      }
      const pointer = pointerAt(move);
      if (mode === "move") {
        const latest = Math.max(start, end - appointment.duration);
        const moved = clamp(snap(pointer.minutes - grabOffset), start, latest);
        current = { timeDate: timeDateAt(pointer.day, moved), duration: appointment.duration };
      } else {
        const finish = clamp(snap(pointer.minutes), initialStart + slotMinutes, end);
        current = { timeDate: appointment.timeDate, duration: finish - initialStart };
      }
      setPreview({ id: appointment.appointmentId, ...current });
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setPreview(null);
      const changed =
        current &&
        (current.timeDate !== appointment.timeDate || current.duration !== appointment.duration);
      if (commit && current && changed) {
        onReschedule(appointment, current.timeDate, current.duration);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  function chooseMenuTarget(event: React.MouseEvent) {
    const block = (event.target as HTMLElement).closest("[data-appointment-id]");
    if (block) {
      const id = Number(block.getAttribute("data-appointment-id"));
      const appointment = appointments.find((item) => item.appointmentId === id);
      if (appointment) setMenuTarget({ kind: "appointment", appointment });
      return;
    }
    const pointer = pointerAt(event);
    const minutes = Math.floor(pointer.minutes / slotMinutes) * slotMinutes;
    setMenuTarget({ kind: "slot", timeDate: timeDateAt(pointer.day, clamp(minutes, start, end - slotMinutes)) });
  }

  const columns = `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto select-none">
      <div
        className="sticky top-0 z-30 grid border-b bg-background"
        style={{ gridTemplateColumns: columns }}
      >
        <div />
        {days.map((day) => {
          const [year, month, date] = day.split("-").map(Number);
          return (
            <div key={day} className="flex items-center justify-center gap-1.5 border-l py-2 text-sm">
              <span className="text-muted-foreground capitalize">
                {weekday.format(new Date(year, month - 1, date))}
              </span>
              <span
                className={`flex size-7 items-center justify-center rounded-full font-medium ${
                  day === today ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {date}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex">
        <div className="relative shrink-0" style={{ width: GUTTER_WIDTH, height: totalHeight }}>
          {hours.map((minutes) => (
            <span
              key={minutes}
              className="absolute right-2 text-xs text-muted-foreground"
              style={{ top: (minutes - start) * pixelsPerMinute + 2 }}
            >
              {hourLabel(minutes)}
            </span>
          ))}
        </div>

        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>
            <div
              ref={daysRef}
              className="grid flex-1"
              style={{
                gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
                height: totalHeight,
              }}
              onContextMenu={chooseMenuTarget}
            >
              {days.map((day) => (
                <div
                  key={day}
                  className={`relative border-l ${workingDays.has(day) ? "" : "bg-muted/50"}`}
                >
                  {Array.from({ length: slotCount }, (_, slot) => (
                    <div
                      key={slot}
                      style={{ height: rowHeight }}
                      className={
                        (slot + 1) * slotMinutes % 60 === 0
                          ? "border-b"
                          : "border-b border-dashed border-border/50"
                      }
                    />
                  ))}

                  {shown
                    .filter((item) => item.timeDate.startsWith(day))
                    .map((item) => {
                      const position = positions.get(item.appointmentId);
                      if (!position) return null;
                      const itemStart = minutesOf(item.timeDate);
                      const width = 100 / position.columns;
                      const original = appointments.find(
                        (candidate) => candidate.appointmentId === item.appointmentId,
                      ) as Appointment;
                      const dragging = preview?.id === item.appointmentId;
                      const timeRange = `${item.timeDate.slice(11, 16)}, ${item.duration} ${t.data.minutes}`;
                      return (
                        <div
                          key={item.appointmentId}
                          data-appointment-id={item.appointmentId}
                          role="button"
                          tabIndex={0}
                          title={`${item.carLabel}\n${item.phone}\n${displayDateTime(item.timeDate)}, ${item.duration} ${t.data.minutes}`}
                          onPointerDown={(event) => beginDrag(event, original, "move")}
                          onDoubleClick={() => onEdit(original)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") onEdit(original);
                          }}
                          className={`appointment-hatch absolute cursor-grab overflow-hidden rounded-sm border border-l-4 border-foreground/40 px-1 text-xs leading-tight ${
                            dragging ? "z-20 cursor-grabbing shadow-lg" : "z-10"
                          } ${item.isDone ? "opacity-60" : ""}`}
                          style={{
                            top: (itemStart - start) * pixelsPerMinute,
                            height: Math.max(
                              (endMinutes(item) - itemStart) * pixelsPerMinute,
                              MIN_BLOCK_HEIGHT,
                            ),
                            left: `calc(${position.column * width}% + 1px)`,
                            width: `calc(${width}% - 2px)`,
                          }}
                        >
                          <div className="flex items-center gap-1 pt-0.5 font-medium">
                            {item.isDone && <CheckIcon className="size-3 shrink-0" />}
                            <span className="truncate">{item.carLabel}</span>
                          </div>
                          <div className="truncate">{item.phone}</div>
                          <div className="truncate text-muted-foreground">{timeRange}</div>
                          <div
                            aria-hidden
                            onPointerDown={(event) => beginDrag(event, original, "resize")}
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          />
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {menuTarget?.kind === "slot" && (
              <>
                <ContextMenuLabel>{displayDateTime(menuTarget.timeDate)}</ContextMenuLabel>
                <ContextMenuItem onSelect={() => onCreate(menuTarget.timeDate)}>
                  <PlusIcon />
                  {t.data.newAppointment}
                </ContextMenuItem>
              </>
            )}
            {menuTarget?.kind === "appointment" && (
              <>
                <ContextMenuLabel>{menuTarget.appointment.carLabel}</ContextMenuLabel>
                <ContextMenuItem onSelect={() => onEdit(menuTarget.appointment)}>
                  <PencilIcon />
                  {t.data.edit}
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => onDelete(menuTarget.appointment)}
                >
                  <Trash2Icon />
                  {t.data.delete}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </div>
  );
}
