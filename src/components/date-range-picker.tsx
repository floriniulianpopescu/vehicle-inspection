import { useState } from "react";
import { CalendarDaysIcon } from "lucide-react";
import { enGB, ro } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { dateOf, toIso, type DateRange } from "@/lib/reports";

/** How far back and ahead the month and year lists go. */
const FIRST_MONTH = new Date(2000, 0, 1);
const LAST_MONTH = new Date(2100, 11, 1);

/**
 * Two separate calendars in a popup: the left one picks the first day, the right one the last
 * day. Each turns its own months and years. Picking a start after the end (or an end before the
 * start) moves the other day along, so the period is never backwards.
 */
export function DateRangePicker({
  range,
  onChange,
}: {
  range: DateRange | null;
  onChange: (range: DateRange) => void;
}) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const from = range ? dateOf(range.from) : undefined;
  const to = range ? dateOf(range.to) : undefined;
  // Each calendar shows its own month, independently of the other.
  const [startMonth, setStartMonth] = useState<Date>(from ?? new Date());
  const [endMonth, setEndMonth] = useState<Date>(to ?? new Date());

  function toggle(next: boolean) {
    if (next) {
      setStartMonth(from ?? new Date());
      setEndMonth(to ?? new Date());
    }
    setOpen(next);
  }

  function pickStart(day: Date | undefined) {
    if (!day) return;
    const start = toIso(day);
    const end = range && range.to >= start ? range.to : start;
    onChange({ from: start, to: end });
  }

  function pickEnd(day: Date | undefined) {
    if (!day) return;
    const end = toIso(day);
    const start = range && range.from <= end ? range.from : end;
    onChange({ from: start, to: end });
  }

  // The chosen period is shaded in both calendars.
  const between = from && to ? [{ from, to }] : [];
  const shared = {
    mode: "single" as const,
    captionLayout: "dropdown" as const,
    startMonth: FIRST_MONTH,
    endMonth: LAST_MONTH,
    showOutsideDays: false,
    locale: language === "ro" ? ro : enGB,
    weekStartsOn: 1 as const,
    modifiers: { period: between },
    modifiersClassNames: { period: "bg-primary/15" },
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <CalendarDaysIcon />
          {t.reports.pickDates}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-0" align="start">
        <div className="flex flex-wrap divide-x">
          <div className="flex flex-col">
            <span className="px-3 pt-3 text-sm font-medium">
              {t.reports.pickFrom}: {range ? displayDate(range.from) : "—"}
            </span>
            <Calendar
              {...shared}
              month={startMonth}
              onMonthChange={setStartMonth}
              selected={from}
              onSelect={pickStart}
            />
          </div>
          <div className="flex flex-col">
            <span className="px-3 pt-3 text-sm font-medium">
              {t.reports.pickTo}: {range ? displayDate(range.to) : "—"}
            </span>
            <Calendar
              {...shared}
              month={endMonth}
              onMonthChange={setEndMonth}
              selected={to}
              onSelect={pickEnd}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">{t.reports.pickHint}</p>
          <Button size="sm" onClick={() => setOpen(false)}>
            {t.reports.pickDone}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
