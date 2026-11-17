import { useEffect, useMemo, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  BarList,
  ColumnChart,
  DataTable,
  LineChart,
  PieChart,
  SplitTable,
  StackedColumnChart,
  type Datum,
  type StackDatum,
} from "@/components/dashboard/charts";
import { FREQUENCIES } from "@/components/data/car-dialog";
import { FormError } from "@/components/data/field";
import { ErrorBoundary } from "@/components/error-boundary";
import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  api,
  errorMessage,
  type DashboardFilters,
  type DashboardSeries,
  type DashboardSummary,
  type Frequency,
  type Grouping,
} from "@/lib/api";
import {
  chartTypes,
  isOverTime,
  last12Months,
  loadCharts,
  METRICS,
  metricInfo,
  newChartId,
  pieSlices,
  pointLabel,
  saveCharts,
  type ChartConfig,
  type ChartType,
} from "@/lib/dashboard";
import { displayDate, parseDate, todayIso } from "@/lib/format";
import { useFocusRefresh } from "@/hooks/use-focus-refresh";
import { useI18n } from "@/lib/i18n";
import { monthRange, yearRange, type DateRange } from "@/lib/reports";

const ALL = "all";
const GROUPINGS: Grouping[] = ["auto", "day", "week", "month"];

function useLocale() {
  const { language } = useI18n();
  return language === "ro" ? "ro-RO" : "en-GB";
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-heading text-3xl font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  config,
  filters,
  onChange,
  onRemove,
}: {
  config: ChartConfig;
  filters: DashboardFilters | null;
  onChange: (config: ChartConfig) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const text = t.dashboard;
  const locale = useLocale();
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const format = (value: number) => number.format(value);
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    [locale],
  );
  const [series, setSeries] = useState<DashboardSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const info = metricInfo(config.metric);
  const refreshed = useFocusRefresh();

  useEffect(() => {
    if (!filters) return;
    let current = true;
    setLoading(true);
    api
      .dashboardSeries(filters, config.metric, config.grouping)
      .then((next) => {
        if (!current) return;
        setSeries(next);
        setError(null);
      })
      .catch((failure) => current && setError(errorMessage(t, failure)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [filters, config.metric, config.grouping, t, refreshed]);

  const data: Datum[] = (series?.points ?? []).map((point) => ({
    key: point.key,
    label: pointLabel(t, locale, config.metric, series?.grouping ?? null, point),
    value: point.value,
  }));
  const empty = series !== null && data.every((datum) => datum.value === 0);
  const partNames = (series?.parts ?? []).map(
    (part) => text.parts[part as keyof typeof text.parts] ?? part,
  );
  const stacks: StackDatum[] = (series?.points ?? []).map((point, index) => ({
    key: point.key,
    label: data[index]?.label ?? point.key,
    parts: point.parts ?? [],
  }));
  const title = text.metrics[config.metric];

  function changeMetric(metric: ChartConfig["metric"]) {
    const allowed = chartTypes(metric);
    onChange({ ...config, metric, chart: allowed.includes(config.chart) ? config.chart : allowed[0] });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          <Button variant="ghost" size="icon-sm" aria-label={text.remove} title={text.remove} onClick={onRemove}>
            <XIcon />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={config.metric} onValueChange={(value) => changeMetric(value as ChartConfig["metric"])}>
            <SelectTrigger size="sm" className="w-64" aria-label={text.measure}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map((item) => (
                <SelectItem key={item.metric} value={item.metric}>
                  {text.metrics[item.metric]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isOverTime(config.metric) && (
            <Select value={config.grouping} onValueChange={(value) => onChange({ ...config, grouping: value as Grouping })}>
              <SelectTrigger size="sm" className="w-32" aria-label={text.grouping}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPINGS.map((grouping) => (
                  <SelectItem key={grouping} value={grouping}>
                    {text.groupings[grouping]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={config.chart} onValueChange={(value) => onChange({ ...config, chart: value as ChartType })}>
            <SelectTrigger size="sm" className="w-48" aria-label={text.chartType}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chartTypes(config.metric).map((chart) => (
                <SelectItem key={chart} value={chart}>
                  {text.charts[chart]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!info.usesPeriod && <p className="text-xs text-muted-foreground">{text.notPeriod}</p>}
        {config.metric.startsWith("new_vs_returning") && (
          <p className="text-xs text-muted-foreground">{text.newReturningHint}</p>
        )}
      </CardHeader>
      {/* While new numbers load, the previous chart stays, dimmed. */}
      <CardContent className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <FormError message={error} />
        <ErrorBoundary
          key={`${config.metric}|${config.chart}|${config.grouping}`}
          fallback={(failure) => (
            <p className="py-16 text-center text-sm text-destructive">
              {text.chartFailed} ({failure.message})
            </p>
          )}
        >
          {series === null ? (
            <div className="h-[220px]" aria-busy />
          ) : empty ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{text.empty}</p>
          ) : config.chart === "columns" ? (
            <ColumnChart data={data} label={title} format={format} />
          ) : config.chart === "line" ? (
            <LineChart data={data} label={title} format={format} />
          ) : config.chart === "stacked" ? (
            <StackedColumnChart data={stacks} partNames={partNames} label={title} format={format} totalLabel={text.total} />
          ) : config.chart === "table" && series?.parts ? (
            <SplitTable data={stacks} partNames={partNames} format={format} keyTitle={text.period} totalLabel={text.total} />
          ) : config.chart === "pie" ? (
            <PieChart
              slices={pieSlices(series?.points ?? []).map((slice) => ({
                ...slice,
                label: pointLabel(t, locale, config.metric, null, slice),
              }))}
              label={title}
              format={format}
              percent={(share) => percent.format(share)}
            />
          ) : config.chart === "bars" ? (
            <BarList data={data} format={format} />
          ) : (
            <DataTable data={data} format={format} keyTitle={text.category} valueTitle={text.count} />
          )}
        </ErrorBoundary>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const text = t.dashboard;
  const locale = useLocale();
  const today = todayIso();
  const initial = yearRange(today);
  const [fromText, setFromText] = useState(displayDate(initial.from));
  const [toText, setToText] = useState(displayDate(initial.to));
  const [frequency, setFrequency] = useState(ALL);
  const [manufacturer, setManufacturer] = useState(ALL);
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [charts, setCharts] = useState<ChartConfig[]>(loadCharts);

  useEffect(() => {
    api.dashboardManufacturers().then(setManufacturers).catch(() => {});
  }, []);

  const range = useMemo<DateRange | null>(() => {
    const from = parseDate(fromText);
    const to = parseDate(toText);
    return from && to && from <= to ? { from, to } : null;
  }, [fromText, toText]);

  // One set of filters scopes every number and chart on the page.
  const filters = useMemo<DashboardFilters | null>(
    () =>
      range
        ? {
            ...range,
            frequency: frequency === ALL ? null : (Number(frequency) as Frequency),
            manufacturer: manufacturer === ALL ? null : manufacturer,
          }
        : null,
    [range, frequency, manufacturer],
  );

  const refreshed = useFocusRefresh();

  useEffect(() => {
    if (!filters) {
      setError(t.data.errors.invalid_date);
      return;
    }
    let current = true;
    api
      .dashboardSummary(filters)
      .then((next) => {
        if (!current) return;
        setSummary(next);
        setError(null);
      })
      .catch((failure) => current && setError(errorMessage(t, failure)));
    return () => {
      current = false;
    };
  }, [filters, t, refreshed]);

  function update(next: ChartConfig[]) {
    setCharts(next);
    saveCharts(next);
  }

  function choose(next: DateRange) {
    setFromText(displayDate(next.from));
    setToText(displayDate(next.to));
  }

  const number = new Intl.NumberFormat(locale);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-32"
          value={fromText}
          aria-label={t.data.filters.from}
          placeholder={t.data.dateFormat}
          onChange={(event) => setFromText(event.target.value)}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          className="w-32"
          value={toText}
          aria-label={t.data.filters.to}
          placeholder={t.data.dateFormat}
          onChange={(event) => setToText(event.target.value)}
        />
        <DateRangePicker range={range} onChange={choose} />
        <Button variant="outline" onClick={() => choose(monthRange(today))}>
          {t.reports.thisMonth}
        </Button>
        <Button variant="outline" onClick={() => choose(yearRange(today))}>
          {t.reports.thisYear}
        </Button>
        <Button variant="outline" onClick={() => choose(last12Months(today))}>
          {text.last12Months}
        </Button>
        <Select value={frequency} onValueChange={setFrequency}>
          <SelectTrigger className="w-40" aria-label={t.data.frequency}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.data.filters.allFrequencies}</SelectItem>
            {FREQUENCIES.map((months) => (
              <SelectItem key={months} value={String(months)}>
                {t.data.months[months]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={manufacturer} onValueChange={setManufacturer}>
          <SelectTrigger className="w-44" aria-label={t.data.manufacturer}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{text.allManufacturers}</SelectItem>
            {manufacturers.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FormError message={error} />

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label={text.tiles.cars} value={number.format(summary.cars)} />
          <StatTile label={text.tiles.inspections} value={number.format(summary.inspections)} />
          <StatTile label={text.tiles.expired} value={number.format(summary.expired)} />
          <StatTile label={text.tiles.messagesSent} value={number.format(summary.messagesSent)} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((config, index) => (
          <ChartCard
            key={config.id}
            config={config}
            filters={filters}
            onChange={(next) => update(charts.map((item, at) => (at === index ? next : item)))}
            onRemove={() => update(charts.filter((_, at) => at !== index))}
          />
        ))}
      </div>

      <Button
        variant="outline"
        className="self-start"
        onClick={() =>
          update([...charts, { id: newChartId(), metric: "inspections_over_time", grouping: "auto", chart: "columns" }])
        }
      >
        <PlusIcon />
        {text.addChart}
      </Button>
    </div>
  );
}
