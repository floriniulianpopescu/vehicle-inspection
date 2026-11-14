import type { DashboardMetric, DashboardPoint, Frequency, Grouping } from "@/lib/api";
import { dateOf, toIso, type DateRange } from "@/lib/reports";
import type { Messages } from "@/locales/ro";

export type ChartType = "columns" | "bars" | "line" | "pie" | "stacked" | "table";

/**
 * time: dated buckets in order; split: dated buckets each divided into parts;
 * ordered: fixed categories; ranked: largest first.
 */
type MetricShape = "time" | "split" | "ordered" | "ranked";

export const METRICS: { metric: DashboardMetric; shape: MetricShape; usesPeriod: boolean }[] = [
  { metric: "inspections_over_time", shape: "time", usesPeriod: true },
  { metric: "inspections_by_manufacturer", shape: "ranked", usesPeriod: true },
  { metric: "inspections_by_frequency", shape: "ordered", usesPeriod: true },
  { metric: "inspections_by_weekday", shape: "ordered", usesPeriod: true },
  { metric: "expiring_over_time", shape: "time", usesPeriod: true },
  { metric: "cars_by_state", shape: "ordered", usesPeriod: false },
  { metric: "cars_by_manufacturer", shape: "ranked", usesPeriod: false },
  { metric: "cars_by_model", shape: "ranked", usesPeriod: false },
  { metric: "cars_by_frequency", shape: "ordered", usesPeriod: false },
  { metric: "messages_over_time", shape: "time", usesPeriod: true },
  { metric: "messages_by_kind", shape: "ordered", usesPeriod: true },
  { metric: "messages_by_status", shape: "ordered", usesPeriod: true },
  { metric: "clients_by_visits", shape: "ordered", usesPeriod: false },
  { metric: "new_vs_returning_over_time", shape: "split", usesPeriod: true },
  { metric: "new_vs_returning", shape: "ordered", usesPeriod: true },
];

/** Measures that are grouped by day, week or month. */
export function isOverTime(metric: DashboardMetric): boolean {
  const shape = metricInfo(metric).shape;
  return shape === "time" || shape === "split";
}

export function metricInfo(metric: DashboardMetric) {
  return METRICS.find((item) => item.metric === metric) ?? METRICS[0];
}

/** The chart types that suit a measure, the first being its default. */
export function chartTypes(metric: DashboardMetric): ChartType[] {
  switch (metricInfo(metric).shape) {
    case "time":
      return ["columns", "line", "table"];
    case "split":
      return ["stacked", "table"];
    case "ranked":
      return ["bars", "columns", "pie", "table"];
    default:
      return ["columns", "bars", "pie", "table"];
  }
}

export type ChartConfig = { id: string; metric: DashboardMetric; grouping: Grouping; chart: ChartType };

const STORAGE_KEY = "dashboard-charts";

export const DEFAULT_CHARTS: ChartConfig[] = [
  { id: "a", metric: "inspections_over_time", grouping: "auto", chart: "columns" },
  { id: "b", metric: "cars_by_state", grouping: "auto", chart: "bars" },
  { id: "c", metric: "inspections_by_manufacturer", grouping: "auto", chart: "bars" },
  { id: "d", metric: "expiring_over_time", grouping: "auto", chart: "line" },
];

function isConfig(value: unknown): value is ChartConfig {
  if (!value || typeof value !== "object") return false;
  const item = value as ChartConfig;
  return (
    typeof item.id === "string" &&
    METRICS.some((known) => known.metric === item.metric) &&
    ["auto", "day", "week", "month"].includes(item.grouping) &&
    chartTypes(item.metric).includes(item.chart)
  );
}

export function loadCharts(): ChartConfig[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(stored)) return stored.filter(isConfig);
  } catch {
    // Unreadable or unavailable: start from the defaults.
  }
  return DEFAULT_CHARTS;
}

export function saveCharts(charts: ChartConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(charts));
  } catch {
    // Kept for this session only.
  }
}

export function newChartId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The last 12 months, ending today. */
export function last12Months(today: string): DateRange {
  const from = dateOf(today);
  from.setFullYear(from.getFullYear() - 1);
  from.setDate(from.getDate() + 1);
  return { from: toIso(from), to: today };
}

const STEPS = [1, 2, 5, 10];

/** Round axis steps covering `max` in at most `count` intervals: 0, 2, 4, 6, 8. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, (STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude);
  const ticks = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}

/** A pie stays readable with at most this many slices. */
export const MAX_SLICES = 6;

export type Slice = { key: string; value: number; share: number; other: boolean };

/**
 * Slices for a pie: empty categories are left out and, past `MAX_SLICES`, the smallest are
 * added up into one "other" slice (together with any "other" the data already had).
 */
export function pieSlices(points: { key: string; value: number }[]): Slice[] {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (total === 0) return [];
  const present = points.filter((point) => point.value > 0);
  let kept = present.filter((point) => point.key !== "__other");
  let rest = present.find((point) => point.key === "__other")?.value ?? 0;
  const room = rest > 0 ? MAX_SLICES - 1 : MAX_SLICES;
  if (kept.length > room) {
    const keep = MAX_SLICES - 1;
    const largest = new Set([...kept].sort((a, b) => b.value - a.value).slice(0, keep));
    rest += kept.filter((point) => !largest.has(point)).reduce((sum, point) => sum + point.value, 0);
    kept = kept.filter((point) => largest.has(point));
  }
  const slices = kept.map((point) => ({ key: point.key, value: point.value, share: point.value / total, other: false }));
  if (rest > 0) slices.push({ key: "__other", value: rest, share: rest / total, other: true });
  return slices;
}

/** How many labels to skip so that about one fits per `room` pixels. */
export function labelEvery(count: number, width: number, room = 56): number {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / room))));
}

/** A readable name for a point's key, in the current language. */
export function pointLabel(
  t: Messages,
  locale: string,
  metric: DashboardMetric,
  grouping: Grouping | null,
  point: DashboardPoint,
): string {
  const text = t.dashboard;
  const key = point.key;
  if (key === "__other") return text.other;
  switch (metric) {
    case "inspections_over_time":
    case "expiring_over_time":
    case "messages_over_time":
    case "new_vs_returning_over_time": {
      if (grouping === "month") {
        const [year, month] = key.split("-").map(Number);
        return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(
          new Date(year, month - 1, 1),
        );
      }
      const [, month, day] = key.split("-");
      return `${day}.${month}`;
    }
    case "inspections_by_frequency":
    case "cars_by_frequency":
      return t.data.months[Number(key) as Frequency] ?? key;
    case "inspections_by_weekday":
      return text.weekdays[Number(key)] ?? key;
    case "cars_by_state":
      return t.data.states[key as keyof Messages["data"]["states"]] ?? key;
    case "messages_by_kind":
      return t.sms.kinds[key as keyof Messages["sms"]["kinds"]] ?? key;
    case "messages_by_status":
      return t.sms.statuses[key as keyof Messages["sms"]["statuses"]] ?? key;
    case "clients_by_visits":
      return key === "4+" ? text.visitsFourPlus : key;
    case "new_vs_returning":
      return text.parts[key as keyof Messages["dashboard"]["parts"]] ?? key;
    default:
      return key || "-";
  }
}
