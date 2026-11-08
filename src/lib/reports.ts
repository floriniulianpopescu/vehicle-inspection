import { addDays, mondayOf } from "@/lib/calendar";

export type DateRange = { from: string; to: string };

export function weekRange(today: string): DateRange {
  const from = mondayOf(today);
  return { from, to: addDays(from, 6) };
}

export function monthRange(today: string): DateRange {
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = today.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

const NICE_STEPS = [1, 2, 5, 10];

/** The smallest round number at or above `value`, used as the top of a chart. */
export function axisMax(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = NICE_STEPS.find((candidate) => candidate * magnitude >= value) as number;
  return step * magnitude;
}

/** How many bars to skip between date labels so at most `maxLabels` are shown. */
export function labelStep(count: number, maxLabels: number): number {
  return Math.max(1, Math.ceil(count / maxLabels));
}

/** Minutes as hours with at most one decimal, in the given locale: 90 becomes "1,5". */
export function hoursText(minutes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
}
