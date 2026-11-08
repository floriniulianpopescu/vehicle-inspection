import { useState } from "react";
import { displayDate } from "@/lib/format";
import { axisMax, labelStep } from "@/lib/reports";

export type DayBar = {
  date: string;
  value: number;
  /** Drawn as a marker across the bar, for example the day's working hours. */
  limit?: number;
  alert?: boolean;
  details: string[];
};

const MAX_DATE_LABELS = 10;
/** Past this many bars there is no room for a gap between them. */
const MAX_BARS_WITH_GAP = 62;
const GRID_FRACTIONS = [1, 0.5, 0];

function dayMonth(date: string): string {
  return displayDate(date).slice(0, 5);
}

export function DayBars({
  bars,
  label,
  locale,
}: {
  bars: DayBar[];
  label: string;
  locale: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const top = axisMax(Math.max(0, ...bars.flatMap((bar) => [bar.value, bar.limit ?? 0])));
  const step = labelStep(bars.length, MAX_DATE_LABELS);
  const axisNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const percent = (value: number) => `${(value / top) * 100}%`;
  const centre = (index: number) => `${((index + 0.5) / bars.length) * 100}%`;
  const barGap = bars.length <= MAX_BARS_WITH_GAP ? 2 : 0;
  const active = hovered === null ? null : bars[hovered];

  // Near the edges the tooltip aligns inward, so it never leaves the chart.
  const tooltipShift =
    hovered === null || (hovered + 0.5) / bars.length < 0.2
      ? "0"
      : (hovered + 0.5) / bars.length > 0.8
        ? "-100%"
        : "-50%";

  return (
    <div role="img" aria-label={label} className="flex gap-2">
      <div className="relative h-44 w-8 shrink-0 text-right text-xs text-muted-foreground">
        {GRID_FRACTIONS.map((fraction) => (
          <span
            key={fraction}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${(1 - fraction) * 100}%` }}
          >
            {axisNumber.format(top * fraction)}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-44" onPointerLeave={() => setHovered(null)}>
          {GRID_FRACTIONS.map((fraction) => (
            <div
              key={fraction}
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${(1 - fraction) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex">
            {bars.map((bar, index) => (
              <div
                key={bar.date}
                className={`relative h-full min-w-0 flex-1 ${hovered === index ? "bg-muted/60" : ""}`}
                onPointerEnter={() => setHovered(index)}
              >
                {bar.value > 0 && (
                  <div
                    className="absolute bottom-0 left-1/2 max-w-6 -translate-x-1/2 rounded-t"
                    style={{
                      height: percent(bar.value),
                      width: `calc(100% - ${barGap}px)`,
                      background: bar.alert ? "var(--viz-alert)" : "var(--viz-series)",
                    }}
                  />
                )}
                {bar.limit !== undefined && bar.limit > 0 && (
                  <div
                    className="absolute inset-x-0 h-0.5 bg-foreground"
                    style={{ bottom: percent(bar.limit) }}
                  />
                )}
              </div>
            ))}
          </div>

          {active && hovered !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
              style={{ left: centre(hovered), transform: `translateX(${tooltipShift})` }}
            >
              <div className="font-medium">{displayDate(active.date)}</div>
              {active.details.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <div className="relative mt-1 h-4 text-xs text-muted-foreground">
          {bars.map((bar, index) =>
            index % step === 0 ? (
              <span
                key={bar.date}
                className="absolute -translate-x-1/2"
                style={{ left: centre(index) }}
              >
                {dayMonth(bar.date)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
