import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** Rows drawn at a time. Thousands of table rows at once make the window stall. */
export const PAGE_ROWS = 100;

/**
 * The first rows of a long list, growing by `PAGE_ROWS` on request. Starts over when `reset`
 * changes (a new filter, for example). Only drawing is limited: the full list is still used
 * for selecting, sending, exporting and printing.
 */
export function useShowMore<T>(items: T[], reset: unknown = items.length) {
  const [limit, setLimit] = useState(PAGE_ROWS);
  useEffect(() => setLimit(PAGE_ROWS), [reset]);
  return {
    shown: items.length > limit ? items.slice(0, limit) : items,
    hidden: Math.max(0, items.length - limit),
    more: () => setLimit((current) => current + PAGE_ROWS),
  };
}

/** "Show 100 more (of 2,350 left)", below a list that is not fully drawn. */
export function ShowMore({ hidden, onMore }: { hidden: number; onMore: () => void }) {
  const { t } = useI18n();
  if (hidden <= 0) return null;
  return (
    <Button variant="outline" size="sm" className="self-center" onClick={onMore}>
      <ChevronDownIcon />
      {fill(t.data.showMore, { count: Math.min(PAGE_ROWS, hidden), left: hidden })}
    </Button>
  );
}
