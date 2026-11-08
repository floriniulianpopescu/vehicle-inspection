import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadCalendarSettings,
  saveCalendarSettings,
  SLOT_LENGTHS,
  type CalendarSettings,
} from "@/lib/calendar";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** 1 January 2024 was a Monday, so day offsets line up with these dates. */
const weekdayDate = (offset: number) => new Date(2024, 0, 1 + offset);

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const hourText = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function HourSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  options: number[];
  onChange: (hour: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger id={id} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((hour) => (
            <SelectItem key={hour} value={String(hour)}>
              {hourText(hour)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CalendarSettingsCard() {
  const { t, language } = useI18n();
  const [settings, setSettings] = useState(loadCalendarSettings);
  const weekday = new Intl.DateTimeFormat(language === "ro" ? "ro-RO" : "en-GB", {
    weekday: "short",
  });

  function update(patch: Partial<CalendarSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveCalendarSettings(next);
  }

  function toggleDay(day: number) {
    const days = settings.days.includes(day)
      ? settings.days.filter((item) => item !== day)
      : [...settings.days, day].sort();
    if (days.length > 0) update({ days });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.calendar}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">{t.settings.workingDays}</span>
          <div className="flex flex-wrap gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <Button
                key={day}
                type="button"
                size="sm"
                className="capitalize"
                variant={settings.days.includes(day) ? "default" : "outline"}
                aria-pressed={settings.days.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {weekday.format(weekdayDate(day))}
              </Button>
            ))}
          </div>
        </div>
        <HourSelect
          id="start-hour"
          label={t.settings.startHour}
          value={settings.startHour}
          options={HOURS.slice(0, 24)}
          onChange={(startHour) =>
            update({ startHour, endHour: Math.max(settings.endHour, startHour + 1) })
          }
        />
        <HourSelect
          id="end-hour"
          label={t.settings.endHour}
          value={settings.endHour}
          options={HOURS.slice(settings.startHour + 1)}
          onChange={(endHour) => update({ endHour })}
        />
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="slot-length">{t.settings.slotLength}</Label>
          <Select
            value={String(settings.slotMinutes)}
            onValueChange={(value) => update({ slotMinutes: Number(value) })}
          >
            <SelectTrigger id="slot-length" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLOT_LENGTHS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {fill(t.settings.minutes, { count: minutes })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
