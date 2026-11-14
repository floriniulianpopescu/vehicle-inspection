export type DateRange = { from: string; to: string };

function isoOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local calendar date for a YYYY-MM-DD string, at midday so time zones cannot shift the day. */
export function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function toIso(date: Date): string {
  return isoOf(date);
}

function addDays(iso: string, days: number): string {
  const date = dateOf(iso);
  date.setDate(date.getDate() + days);
  return isoOf(date);
}

export function weekRange(today: string): DateRange {
  // Monday is the first day of the week.
  const from = addDays(today, -((dateOf(today).getDay() + 6) % 7));
  return { from, to: addDays(from, 6) };
}

export function monthRange(today: string): DateRange {
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = today.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

export function yearRange(today: string): DateRange {
  const year = today.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
