export type CalendarSettings = {
  /** Working days, where 0 is Monday and 6 is Sunday. */
  days: number[];
  startHour: number;
  endHour: number;
  slotMinutes: number;
};

export const SLOT_LENGTHS = [15, 20, 30, 60];

const DEFAULT_SETTINGS: CalendarSettings = {
  days: [0, 1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 18,
  slotMinutes: 30,
};

const STORAGE_KEY = "calendar-settings";
const MINUTES_IN_DAY = 24 * 60;

function isValid(value: CalendarSettings): boolean {
  return (
    Array.isArray(value.days) &&
    value.days.length > 0 &&
    value.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    Number.isInteger(value.startHour) &&
    Number.isInteger(value.endHour) &&
    value.startHour >= 0 &&
    value.endHour <= 24 &&
    value.startHour < value.endHour &&
    SLOT_LENGTHS.includes(value.slotMinutes)
  );
}

export function loadCalendarSettings(): CalendarSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return stored && isValid(stored) ? stored : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveCalendarSettings(settings: CalendarSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Calendar arithmetic on local dates, so daylight saving cannot shift a day. */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function mondayOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const mondayIndexed = (new Date(year, month - 1, day).getDay() + 6) % 7;
  return addDays(iso, -mondayIndexed);
}

export function minutesOf(timeDate: string): number {
  return Number(timeDate.slice(11, 13)) * 60 + Number(timeDate.slice(14, 16));
}

export function timeDateAt(day: string, minutes: number): string {
  return `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type Timed = { timeDate: string; duration: number };

export function endMinutes(item: Timed): number {
  return Math.min(minutesOf(item.timeDate) + item.duration, MINUTES_IN_DAY);
}

/** The working days of the week, plus any other day holding an appointment. */
export function visibleDays(
  weekStart: string,
  settings: CalendarSettings,
  appointments: Timed[],
): string[] {
  const occupied = new Set(appointments.map((item) => item.timeDate.slice(0, 10)));
  return [0, 1, 2, 3, 4, 5, 6]
    .filter((offset) => settings.days.includes(offset) || occupied.has(addDays(weekStart, offset)))
    .map((offset) => addDays(weekStart, offset));
}

/** Working hours in minutes, widened to whole hours around any appointment outside them. */
export function visibleRange(
  settings: CalendarSettings,
  appointments: Timed[],
): { start: number; end: number } {
  let start = settings.startHour * 60;
  let end = settings.endHour * 60;
  for (const item of appointments) {
    start = Math.min(start, Math.floor(minutesOf(item.timeDate) / 60) * 60);
    end = Math.max(end, Math.ceil(endMinutes(item) / 60) * 60);
  }
  return { start, end };
}

export type DayEvent = { id: number; start: number; end: number };
export type EventPosition = { column: number; columns: number };

/** Places overlapping events side by side, in as few columns as each cluster needs. */
export function layoutDay(events: DayEvent[]): Map<number, EventPosition> {
  const positions = new Map<number, EventPosition>();
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);

  let cluster: { id: number; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  function flush() {
    for (const { id, column } of cluster) {
      positions.set(id, { column, columns: columnEnds.length });
    }
    cluster = [];
    columnEnds = [];
  }

  for (const event of sorted) {
    if (event.start >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= event.start);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = event.end;
    cluster.push({ id: event.id, column });
    clusterEnd = Math.max(clusterEnd, event.end);
  }
  flush();

  return positions;
}
