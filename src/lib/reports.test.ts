import { describe, expect, test } from "bun:test";
import { axisMax, labelStep, monthRange, weekRange } from "./reports";

describe("date ranges", () => {
  test("a week runs Monday to Sunday, also from a Sunday", () => {
    expect(weekRange("2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(weekRange("2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  test("a month ends on its real last day", () => {
    expect(monthRange("2026-11-08")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("chart scale", () => {
  test("the axis rounds up to a round number", () => {
    expect(axisMax(0)).toBe(1);
    expect(axisMax(3)).toBe(5);
    expect(axisMax(10)).toBe(10);
    expect(axisMax(11)).toBe(20);
    expect(axisMax(55)).toBe(100);
  });

  test("labels thin out as bars increase", () => {
    expect(labelStep(7, 10)).toBe(1);
    expect(labelStep(31, 10)).toBe(4);
    expect(labelStep(366, 10)).toBe(37);
  });
});
