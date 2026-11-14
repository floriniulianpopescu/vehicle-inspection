import { useState } from "react";
import { CalendarDaysIcon } from "lucide-react";
import type { DateRange as PickedRange } from "react-day-picker";
import { enGB, ro } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { dateOf, toIso, type DateRange } from "@/lib/reports";

/** A month calendar in a popup: the first click picks the start day, the second the end day. */
export function DateRangePicker({
  range,
  onChange,
}: {
  range: DateRange | null;
  onChange: (range: DateRange) => void;
}) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  // The start day while waiting for the second click.
  const [start, setStart] = useState<string | null>(null);
  const selected: PickedRange | undefined = range
    ? { from: dateOf(range.from), to: dateOf(range.to) }
    : undefined;

  function select(_picked: PickedRange | undefined, clicked: Date) {
    const day = toIso(clicked);
    if (start === null) {
      setStart(day);
      onChange({ from: day, to: day });
      return;
    }
    setStart(null);
    onChange(start <= day ? { from: start, to: day } : { from: day, to: start });
    setOpen(false);
  }

  function toggle(next: boolean) {
    setStart(null);
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <CalendarDaysIcon />
          {t.reports.pickDates}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          showOutsideDays={false}
          locale={language === "ro" ? ro : enGB}
          weekStartsOn={1}
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={select}
        />
        <p className="px-3 pb-3 text-xs text-muted-foreground">{t.reports.pickHint}</p>
      </PopoverContent>
    </Popover>
  );
}
