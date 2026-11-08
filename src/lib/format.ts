/** "2026-11-09" or "2026-11-09T09:30" becomes "09.11.2026". */
export function displayDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

/** "2026-11-09T09:30" becomes "09.11.2026 09:30". */
export function displayDateTime(iso: string): string {
  return `${displayDate(iso)} ${iso.slice(11, 16)}`;
}

/** "9.11.2026" becomes "2026-11-09". Returns null unless it is a real date. */
export function parseDate(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

/** "9:30" becomes "09:30". Returns null unless it is a real time. */
export function parseTime(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
}
