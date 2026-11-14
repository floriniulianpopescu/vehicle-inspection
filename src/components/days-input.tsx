import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { MAX_EXPIRING_DAYS } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Whole days from 1 to `MAX_EXPIRING_DAYS`, applied when the field loses focus or on Enter. */
export function clampDays(text: string): number | null {
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return null;
  return Math.min(MAX_EXPIRING_DAYS, Math.max(1, value));
}

export function DaysInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (days: number) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(String(value));

  useEffect(() => setText(String(value)), [value]);

  function commit() {
    const days = clampDays(text);
    if (days === null) {
      setText(String(value));
      return;
    }
    setText(String(days));
    if (days !== value) onCommit(days);
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span>{label}</span>
      <Input
        className="w-20"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_EXPIRING_DAYS}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      <span>{t.reports.days}</span>
    </label>
  );
}
