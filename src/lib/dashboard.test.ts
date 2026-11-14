import { describe, expect, test } from "bun:test";
import { chartTypes, labelEvery, last12Months, MAX_SLICES, niceTicks, pieSlices } from "./dashboard";

describe("axis", () => {
  test("ticks are round numbers covering the largest value", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(42)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(1300)).toEqual([0, 500, 1000, 1500]);
  });

  test("labels thin out when they would not fit", () => {
    expect(labelEvery(12, 700)).toBe(1);
    expect(labelEvery(31, 560)).toBe(4);
  });
});

describe("pie slices", () => {
  test("empty categories are left out and shares add up to one", () => {
    const slices = pieSlices([
      { key: "ok", value: 3 },
      { key: "soon", value: 0 },
      { key: "overdue", value: 1 },
    ]);
    expect(slices.map((slice) => slice.key)).toEqual(["ok", "overdue"]);
    expect(slices.map((slice) => slice.share)).toEqual([0.75, 0.25]);
  });

  test("past six slices the smallest become one other slice, keeping the order", () => {
    const points = ["0", "1", "2", "3", "4", "5", "6"].map((key, index) => ({ key, value: index + 1 }));
    const slices = pieSlices(points);
    expect(slices).toHaveLength(MAX_SLICES);
    expect(slices.map((slice) => slice.key)).toEqual(["2", "3", "4", "5", "6", "__other"]);
    expect(slices[slices.length - 1].value).toBe(1 + 2);
  });

  test("an existing other is merged rather than repeated", () => {
    const points = [...Array(12)].map((_, index) => ({ key: `m${index}`, value: 20 - index }));
    const slices = pieSlices([...points, { key: "__other", value: 5 }]);
    expect(slices).toHaveLength(MAX_SLICES);
    expect(slices.filter((slice) => slice.other)).toHaveLength(1);
    expect(slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(points.reduce((sum, p) => sum + p.value, 0) + 5);
  });

  test("nothing to show gives no slices", () => {
    expect(pieSlices([{ key: "a", value: 0 }])).toEqual([]);
  });
});

describe("periods and chart types", () => {
  test("the last 12 months end today", () => {
    expect(last12Months("2026-11-14")).toEqual({ from: "2025-11-15", to: "2026-11-14" });
  });

  test("each measure offers the chart types that suit it, its default first", () => {
    expect(chartTypes("inspections_over_time")).toEqual(["columns", "line", "table"]);
    expect(chartTypes("cars_by_manufacturer")[0]).toBe("bars");
    expect(chartTypes("cars_by_state")).not.toContain("line");
    expect(chartTypes("cars_by_state")).toContain("pie");
    expect(chartTypes("inspections_over_time")).not.toContain("pie");
    expect(chartTypes("new_vs_returning_over_time")).toEqual(["stacked", "table"]);
    expect(chartTypes("new_vs_returning")).toContain("pie");
  });
});
