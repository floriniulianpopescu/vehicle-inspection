import { describe, expect, test } from "bun:test";
import { dateOf, monthRange, toIso, weekRange, yearRange } from "./reports";

describe("date ranges", () => {
  test("a week runs Monday to Sunday, also from a Sunday", () => {
    expect(weekRange("2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(weekRange("2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  test("a week can cross a month and a year", () => {
    expect(weekRange("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  test("a month ends on its real last day", () => {
    expect(monthRange("2026-11-08")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  test("a year runs January to December", () => {
    expect(yearRange("2026-11-08")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  test("dates survive the trip through the calendar picker", () => {
    expect(toIso(dateOf("2026-03-29"))).toBe("2026-03-29");
    expect(toIso(dateOf("2026-10-25"))).toBe("2026-10-25");
  });
});
