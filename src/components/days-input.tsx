import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { MAX_EXPIRING_DAYS } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Pause after the last key before a typed value is applied. */
const APPLY_AFTER_MS = 400;

/** Whole days from 1 to `MAX_EXPIRING_DAYS`. */
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

  // Applied by itself shortly after typing stops, so the list updates without leaving the field.
  useEffect(() => {
    const days = clampDays(text);
    if (days === null || days === value) return;
    const timer = window.setTimeout(() => onCommit(days), APPLY_AFTER_MS);
    return () => window.clearTimeout(timer);
    // onCommit is rebuilt on every render of the parent; the text is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value]);

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
