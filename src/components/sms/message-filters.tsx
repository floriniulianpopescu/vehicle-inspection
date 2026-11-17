import { useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { displayDate, parseDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { compactPlate } from "@/lib/romanian";

/**
 * A search field and a period for a message list. The days are typed or chosen on the
 * calendar; an empty day means no limit on that side, a half-typed one is ignored.
 */
export function useMessageFilters(dateLabel: string) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const from = parseDate(fromText);
  const to = parseDate(toText);

  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={search}
          placeholder={t.sms.searchPlaceholder}
          aria-label={t.sms.searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <span className="text-sm">{dateLabel}</span>
      <Input
        className="w-32"
        value={fromText}
        aria-label={`${dateLabel}: ${t.data.filters.from}`}
        aria-invalid={fromText.trim() !== "" && !from}
        placeholder={t.data.filters.from}
        onChange={(event) => setFromText(event.target.value)}
      />
      <span className="text-muted-foreground">–</span>
      <Input
        className="w-32"
        value={toText}
        aria-label={`${dateLabel}: ${t.data.filters.to}`}
        aria-invalid={toText.trim() !== "" && !to}
        placeholder={t.data.filters.to}
        onChange={(event) => setToText(event.target.value)}
      />
      <DateRangePicker
        range={from && to ? { from, to } : null}
        onChange={(range) => {
          setFromText(displayDate(range.from));
          setToText(displayDate(range.to));
        }}
      />
      {(search || fromText || toText) && (
        <Button
          variant="ghost"
          size="icon"
          title={t.sms.clearFilters}
          aria-label={t.sms.clearFilters}
          onClick={() => {
            setSearch("");
            setFromText("");
            setToText("");
          }}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );

  return { search: search.trim(), from, to, bar, key: `${search.trim()}|${from}|${to}` };
}

/** Whether a message matches the search: by phone (spaces ignored), plate or text. */
export function matchesSearch(
  message: { phone: string; plate: string | null; text: string },
  search: string,
): boolean {
  if (!search) return true;
  const digits = search.replace(/\D/g, "");
  if (digits.length >= 3 && message.phone.includes(digits)) return true;
  const plate = compactPlate(search).replace(/[^A-Z0-9]/g, "");
  if (plate && message.plate && message.plate.includes(plate)) return true;
  return message.text.toLowerCase().includes(search.toLowerCase());
}

/** Whether an ISO day falls within the period; an open side has no limit. */
export function withinDays(day: string, from: string | null, to: string | null): boolean {
  const date = day.slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}
