import { describe, expect, test } from "bun:test";
import { addDays, layoutDay, mondayOf, timeDateAt, visibleDays, visibleRange } from "./calendar";

const settings = { days: [0, 1, 2, 3, 4, 5], startHour: 8, endHour: 18, slotMinutes: 30 };

describe("dates", () => {
  test("a week starts on Monday", () => {
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
  });

  test("adding days crosses months and daylight saving", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  test("minutes become a local date and time", () => {
    expect(timeDateAt("2026-11-09", 570)).toBe("2026-11-09T09:30");
  });
});

describe("visible calendar", () => {
  const week = "2026-11-09";

  test("shows only working days by default", () => {
    expect(visibleDays(week, settings, [])).toHaveLength(6);
  });

  test("adds a non-working day holding an appointment", () => {
    const days = visibleDays(week, settings, [{ timeDate: "2026-11-15T10:00", duration: 30 }]);
    expect(days).toContain("2026-11-15");
  });

  test("widens hours to whole hours around outside appointments", () => {
    expect(
      visibleRange(settings, [
        { timeDate: "2026-11-09T07:30", duration: 30 },
        { timeDate: "2026-11-09T18:10", duration: 30 },
      ]),
    ).toEqual({ start: 420, end: 1140 });
  });

  test("an appointment running past midnight stops at the end of the day", () => {
    expect(visibleRange(settings, [{ timeDate: "2026-11-09T23:00", duration: 180 }]).end).toBe(1440);
  });
});

describe("layoutDay", () => {
  test("events that only touch share a column", () => {
    const positions = layoutDay([
      { id: 1, start: 0, end: 30 },
      { id: 2, start: 30, end: 60 },
    ]);
    expect(positions.get(1)).toEqual({ column: 0, columns: 1 });
    expect(positions.get(2)).toEqual({ column: 0, columns: 1 });
  });

  test("overlapping events sit side by side", () => {
    const positions = layoutDay([
      { id: 1, start: 0, end: 60 },
      { id: 2, start: 30, end: 90 },
      { id: 3, start: 30, end: 90 },
    ]);
    expect(positions.get(1)).toEqual({ column: 0, columns: 3 });
    expect(positions.get(2)).toEqual({ column: 1, columns: 3 });
    expect(positions.get(3)).toEqual({ column: 2, columns: 3 });
  });

  test("a free column is reused within a cluster", () => {
    const positions = layoutDay([
      { id: 1, start: 0, end: 120 },
      { id: 2, start: 0, end: 30 },
      { id: 3, start: 60, end: 90 },
    ]);
    expect(positions.get(3)).toEqual({ column: 0, columns: 2 });
    expect(positions.get(2)).toEqual({ column: 0, columns: 2 });
    expect(positions.get(1)).toEqual({ column: 1, columns: 2 });
  });

  test("separate clusters are sized independently", () => {
    const positions = layoutDay([
      { id: 1, start: 0, end: 30 },
      { id: 2, start: 0, end: 30 },
      { id: 3, start: 60, end: 90 },
    ]);
    expect(positions.get(3)).toEqual({ column: 0, columns: 1 });
  });
});
