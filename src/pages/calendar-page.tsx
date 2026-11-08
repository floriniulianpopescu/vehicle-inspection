import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { WeekGrid } from "@/components/calendar/week-grid";
import { AppointmentDialog } from "@/components/data/appointment-dialog";
import { DeleteAppointmentDialog } from "@/components/data/delete-dialog";
import { RevisionDialog } from "@/components/data/revision-dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage, type Appointment, type RevisionPrompt } from "@/lib/api";
import { addDays, loadCalendarSettings, mondayOf, visibleDays, visibleRange } from "@/lib/calendar";
import { displayDate, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Editing = { appointment: Appointment | null; timeDate?: string };

export function CalendarPage() {
  const { t } = useI18n();
  const [settings] = useState(loadCalendarSettings);
  const today = todayIso();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [prompt, setPrompt] = useState<RevisionPrompt | null>(null);

  const weekEnd = addDays(weekStart, 6);

  useEffect(() => {
    let stale = false;
    api
      .appointmentsBetween(weekStart, weekEnd)
      .then((rows) => {
        if (!stale) setAppointments(rows);
      })
      .catch((failure) => {
        if (!stale) toast.error(errorMessage(t, failure));
      });
    return () => {
      stale = true;
    };
  }, [weekStart, weekEnd, refreshKey]);

  const refresh = () => setRefreshKey((key) => key + 1);

  async function reschedule(appointment: Appointment, timeDate: string, duration: number) {
    // Stay where it was dropped while saving; the reload corrects it on failure.
    setAppointments((rows) =>
      rows.map((row) =>
        row.appointmentId === appointment.appointmentId ? { ...row, timeDate, duration } : row,
      ),
    );
    try {
      await api.saveAppointment({
        appointmentId: appointment.appointmentId,
        clientId: appointment.clientId,
        carId: appointment.carId,
        timeDate,
        isDone: appointment.isDone,
        duration,
      });
    } catch (failure) {
      toast.error(errorMessage(t, failure));
    }
    refresh();
  }

  const days = visibleDays(weekStart, settings, appointments);
  const { start, end } = visibleRange(settings, appointments);
  const workingDays = new Set(settings.days.map((offset) => addDays(weekStart, offset)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Button variant="outline" onClick={() => setWeekStart(mondayOf(today))}>
          {t.calendar.today}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t.calendar.previousWeek}
          aria-label={t.calendar.previousWeek}
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t.calendar.nextWeek}
          aria-label={t.calendar.nextWeek}
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          <ChevronRightIcon />
        </Button>
        <h1 className="font-heading font-semibold">
          {displayDate(weekStart)} – {displayDate(weekEnd)}
        </h1>
      </div>

      <WeekGrid
        days={days}
        start={start}
        end={end}
        slotMinutes={settings.slotMinutes}
        workingDays={workingDays}
        today={today}
        appointments={appointments}
        onCreate={(timeDate) => setEditing({ appointment: null, timeDate })}
        onEdit={(appointment) => setEditing({ appointment })}
        onDelete={setDeleting}
        onReschedule={reschedule}
      />

      {editing && (
        <AppointmentDialog
          appointment={editing.appointment}
          initialTimeDate={editing.timeDate}
          onClose={() => setEditing(null)}
          onSaved={(revisionPrompt) => {
            setEditing(null);
            setPrompt(revisionPrompt);
            refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteAppointmentDialog
          appointment={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            refresh();
          }}
        />
      )}
      {prompt && (
        <RevisionDialog
          prompt={prompt}
          onClose={() => setPrompt(null)}
          onSaved={() => {
            setPrompt(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
