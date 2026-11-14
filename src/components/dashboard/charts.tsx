import { useEffect, useRef, useState, type ReactNode } from "react";
import { labelEvery, niceTicks, type Slice } from "@/lib/dashboard";

/** One value to draw, already labelled for display. */
export type Datum = { key: string; label: string; value: number };

const HEIGHT = 220;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 };
const BAR_MAX = 24;
const RADIUS = 4;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** The value leads, the label follows. */
function Tooltip({ x, y, datum, format }: { x: number; y: number; datum: Datum; format: (n: number) => string }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
      style={{ left: x, top: y - 6 }}
    >
      <div className="text-sm font-semibold tabular-nums">{format(datum.value)}</div>
      <div className="text-muted-foreground">{datum.label}</div>
    </div>
  );
}

/** A rectangle rounded only at the top, growing from the baseline. */
function columnPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/** Grid lines and tick labels on the value axis, shared by columns and line. */
function ValueAxis({ ticks, scale, width, format }: { ticks: number[]; scale: (n: number) => number; width: number; format: (n: number) => string }) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={scale(tick)}
            y2={scale(tick)}
            className="stroke-foreground/10"
            strokeWidth={1}
          />
          <text
            x={MARGIN.left - 6}
            y={scale(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {format(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

function CategoryLabels({ data, center, width }: { data: Datum[]; center: (index: number) => number; width: number }) {
  const every = labelEvery(data.length, width - MARGIN.left - MARGIN.right);
  return (
    <g>
      {data.map((datum, index) =>
        index % every === 0 ? (
          <text
            key={datum.key}
            x={center(index)}
            y={HEIGHT - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {datum.label}
          </text>
        ) : null,
      )}
    </g>
  );
}

function Frame({ label, children, overlay }: { label: string; children: (width: number) => ReactNode; overlay?: ReactNode }) {
  const { ref, width } = useWidth();
  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          {children(width)}
        </svg>
      )}
      {overlay}
    </div>
  );
}

/** One date bucket divided into named parts, drawn bottom to top in part order. */
export type StackDatum = { key: string; label: string; parts: number[] };

const PART_COLORS = ["var(--viz-cat-1)", "var(--viz-cat-2)"];
/** The surface gap between stacked segments. */
const GAP = 2;

/** A rectangle with rounded top corners only when `round` (the top segment of a stack). */
function segmentPath(x: number, y: number, width: number, height: number, round: boolean): string {
  return round ? columnPath(x, y, width, height) : `M${x},${y}h${width}v${height}h${-width}Z`;
}

/** Columns divided into parts (here first-time and returning), with a legend naming each part. */
export function StackedColumnChart({
  data,
  partNames,
  label,
  format,
  totalLabel,
}: {
  data: StackDatum[];
  partNames: string[];
  label: string;
  format: (n: number) => string;
  totalLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const totals = data.map((datum) => datum.parts.reduce((sum, part) => sum + part, 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1];
  const activeDatum = active === null ? null : data[active];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {partNames.map((name, index) => (
          <span key={name} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: PART_COLORS[index] }} />
            {name}
          </span>
        ))}
      </div>
      <Frame
        label={label}
        overlay={
          activeDatum &&
          tip && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
              style={{ left: tip.x, top: tip.y - 6 }}
            >
              <div className="mb-0.5 text-muted-foreground">{activeDatum.label}</div>
              {partNames.map((name, index) => (
                <div key={name} className="flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3" style={{ background: PART_COLORS[index] }} />
                  <span className="font-semibold tabular-nums">{format(activeDatum.parts[index] ?? 0)}</span>
                  <span className="text-muted-foreground">{name}</span>
                </div>
              ))}
              <div className="mt-0.5 border-t pt-0.5 text-muted-foreground">
                {totalLabel}: <span className="font-semibold text-popover-foreground tabular-nums">{format(totals[active ?? 0])}</span>
              </div>
            </div>
          )
        }
      >
        {(width) => {
          const plot = width - MARGIN.left - MARGIN.right;
          const band = plot / Math.max(1, data.length);
          const barWidth = Math.max(2, Math.min(BAR_MAX, band - 2));
          const scale = (value: number) => MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - value / top);
          const center = (index: number) => MARGIN.left + band * index + band / 2;
          return (
            <>
              <ValueAxis ticks={ticks} scale={scale} width={width} format={format} />
              {data.map((datum, index) => {
                const x = center(index) - barWidth / 2;
                const topPart = datum.parts.reduce((last, part, at) => (part > 0 ? at : last), -1);
                let below = 0;
                const show = () => {
                  setActive(index);
                  setTip({ x: center(index), y: scale(totals[index]) });
                };
                return (
                  <g key={datum.key} opacity={active === null || active === index ? 1 : 0.55}>
                    {datum.parts.map((part, at) => {
                      if (part <= 0) return null;
                      const y = scale(below + part);
                      // Every segment but the lowest leaves a surface gap beneath it.
                      const height = scale(below) - y - (below > 0 ? GAP : 0);
                      below += part;
                      return height > 0 ? (
                        <path key={at} d={segmentPath(x, y, barWidth, height, at === topPart)} fill={PART_COLORS[at]} />
                      ) : null;
                    })}
                    <rect
                      x={MARGIN.left + band * index}
                      y={MARGIN.top}
                      width={band}
                      height={HEIGHT - MARGIN.top - MARGIN.bottom}
                      fill="transparent"
                      tabIndex={0}
                      aria-label={`${datum.label}: ${partNames
                        .map((name, at) => `${name} ${format(datum.parts[at] ?? 0)}`)
                        .join(", ")}`}
                      onPointerEnter={show}
                      onFocus={show}
                      onPointerLeave={() => setActive(null)}
                      onBlur={() => setActive(null)}
                      className="outline-none"
                    />
                  </g>
                );
              })}
              <CategoryLabels data={data.map((datum, index) => ({ ...datum, value: totals[index] }))} center={center} width={width} />
            </>
          );
        }}
      </Frame>
    </div>
  );
}

/** A table of a split measure: one row per bucket, one column per part, and the total. */
export function SplitTable({
  data,
  partNames,
  format,
  keyTitle,
  totalLabel,
}: {
  data: StackDatum[];
  partNames: string[];
  format: (n: number) => string;
  keyTitle: string;
  totalLabel: string;
}) {
  return (
    <div className="max-h-[260px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">{keyTitle}</th>
            {partNames.map((name) => (
              <th key={name} className="py-1 text-right font-medium">
                {name}
              </th>
            ))}
            <th className="py-1 text-right font-medium">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key} className="border-t border-foreground/10">
              <td className="py-1">{datum.label}</td>
              {datum.parts.map((part, index) => (
                <td key={index} className="py-1 text-right tabular-nums">
                  {format(part)}
                </td>
              ))}
              <td className="py-1 text-right font-medium tabular-nums">
                {format(datum.parts.reduce((sum, part) => sum + part, 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical bars from one baseline, for ordered categories and dates. */
export function ColumnChart({ data, label, format }: { data: Datum[]; label: string; format: (n: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const ticks = niceTicks(Math.max(...data.map((datum) => datum.value), 0));
  const top = ticks[ticks.length - 1];

  return (
    <Frame
      label={label}
      overlay={active !== null && tip && <Tooltip x={tip.x} y={tip.y} datum={data[active]} format={format} />}
    >
      {(width) => {
        const plot = width - MARGIN.left - MARGIN.right;
        const band = plot / Math.max(1, data.length);
        const barWidth = Math.max(2, Math.min(BAR_MAX, band - 2));
        const scale = (value: number) => MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - value / top);
        const center = (index: number) => MARGIN.left + band * index + band / 2;
        return (
          <>
            <ValueAxis ticks={ticks} scale={scale} width={width} format={format} />
            {data.map((datum, index) => {
              const y = scale(datum.value);
              const height = scale(0) - y;
              const show = () => {
                setActive(index);
                setTip({ x: center(index), y });
              };
              return (
                <g key={datum.key}>
                  {height > 0 && (
                    <path
                      d={columnPath(center(index) - barWidth / 2, y, barWidth, height)}
                      fill="var(--viz-series)"
                      opacity={active === null || active === index ? 1 : 0.55}
                    />
                  )}
                  {/* The whole band is the hover target, not just the painted bar. */}
                  <rect
                    x={MARGIN.left + band * index}
                    y={MARGIN.top}
                    width={band}
                    height={HEIGHT - MARGIN.top - MARGIN.bottom}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${datum.label}: ${format(datum.value)}`}
                    onPointerEnter={show}
                    onFocus={show}
                    onPointerLeave={() => setActive(null)}
                    onBlur={() => setActive(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
            <CategoryLabels data={data} center={center} width={width} />
          </>
        );
      }}
    </Frame>
  );
}

/** A line over time with a light wash beneath; the pointer snaps to the nearest date. */
export function LineChart({ data, label, format }: { data: Datum[]; label: string; format: (n: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const ticks = niceTicks(Math.max(...data.map((datum) => datum.value), 0));
  const top = ticks[ticks.length - 1];

  return (
    <Frame
      label={label}
      overlay={active !== null && tip && <Tooltip x={tip.x} y={tip.y} datum={data[active]} format={format} />}
    >
      {(width) => {
        const plot = width - MARGIN.left - MARGIN.right;
        const step = data.length > 1 ? plot / (data.length - 1) : 0;
        const x = (index: number) => MARGIN.left + (data.length > 1 ? step * index : plot / 2);
        const scale = (value: number) => MARGIN.top + (HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - value / top);
        const line = data.map((datum, index) => `${index ? "L" : "M"}${x(index)},${scale(datum.value)}`).join("");
        const area = `${line}L${x(data.length - 1)},${scale(0)}L${x(0)},${scale(0)}Z`;
        const last = data.length - 1;
        const pick = (pointerX: number) => {
          const index = Math.max(0, Math.min(last, Math.round((pointerX - MARGIN.left) / (step || 1))));
          setActive(index);
          setTip({ x: x(index), y: scale(data[index].value) });
        };
        return (
          <>
            <ValueAxis ticks={ticks} scale={scale} width={width} format={format} />
            <path d={area} fill="var(--viz-series)" opacity={0.1} />
            <path d={line} fill="none" stroke="var(--viz-series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {active !== null && (
              <>
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={MARGIN.top}
                  y2={scale(0)}
                  className="stroke-foreground/30"
                  strokeWidth={1}
                />
                <circle cx={x(active)} cy={scale(data[active].value)} r={4} fill="var(--viz-series)" className="stroke-card" strokeWidth={2} />
              </>
            )}
            {/* The latest value is labelled at the end of the line. */}
            <circle cx={x(last)} cy={scale(data[last].value)} r={4} fill="var(--viz-series)" className="stroke-card" strokeWidth={2} />
            <CategoryLabels data={data} center={x} width={width} />
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plot}
              height={HEIGHT - MARGIN.top - MARGIN.bottom}
              fill="transparent"
              tabIndex={0}
              aria-label={label}
              onPointerMove={(event) => pick(event.nativeEvent.offsetX)}
              onPointerLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
              onFocus={() => pick(x(last))}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = (active ?? last) + (event.key === "ArrowRight" ? 1 : -1);
                pick(x(Math.max(0, Math.min(last, next))));
              }}
              className="outline-none"
            />
          </>
        );
      }}
    </Frame>
  );
}

const PIE_SIZE = 180;

/** Slice colours in fixed order; the folded remainder is always the neutral gray. */
function sliceColor(slice: Slice, index: number): string {
  return slice.other ? "var(--viz-other)" : `var(--viz-cat-${index + 1})`;
}

function arcPath(start: number, end: number, radius: number): string {
  const center = PIE_SIZE / 2;
  const point = (angle: number) => [center + radius * Math.sin(angle), center - radius * Math.cos(angle)];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${center},${center}L${x1},${y1}A${radius},${radius} 0 ${large} 1 ${x2},${y2}Z`;
}

/**
 * A pie with a legend that names every slice with its count and share, so nothing depends on
 * judging angles. Slices are parted by a thin gap in the card colour.
 */
export function PieChart({
  slices,
  label,
  format,
  percent,
}: {
  slices: (Slice & { label: string })[];
  label: string;
  format: (n: number) => string;
  percent: (share: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const radius = PIE_SIZE / 2 - 4;
  let angle = 0;
  const arcs = slices.map((slice) => {
    const start = angle;
    angle += slice.share * Math.PI * 2;
    return { start, end: angle };
  });

  return (
    <div className="flex flex-wrap items-center gap-6 py-2">
      <svg width={PIE_SIZE} height={PIE_SIZE} role="img" aria-label={label} className="shrink-0">
        {slices.map((slice, index) => {
          const shown = active === null || active === index;
          const common = {
            fill: sliceColor(slice, index),
            opacity: shown ? 1 : 0.4,
            className: "stroke-card outline-none",
            strokeWidth: 2,
            tabIndex: 0,
            "aria-label": `${slice.label}: ${format(slice.value)} (${percent(slice.share)})`,
            onPointerEnter: () => setActive(index),
            onPointerLeave: () => setActive(null),
            onFocus: () => setActive(index),
            onBlur: () => setActive(null),
          };
          return slices.length === 1 ? (
            <circle key={slice.key} cx={PIE_SIZE / 2} cy={PIE_SIZE / 2} r={radius} {...common} />
          ) : (
            <path key={slice.key} d={arcPath(arcs[index].start, arcs[index].end, radius)} {...common} />
          );
        })}
      </svg>
      <ul className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
        {slices.map((slice, index) => (
          <li
            key={slice.key}
            className={`grid grid-cols-[0.75rem_1fr_auto_3.5rem] items-center gap-2 rounded-sm px-1 ${active === index ? "bg-foreground/5" : ""}`}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive(null)}
          >
            <span aria-hidden className="size-3 rounded-sm" style={{ background: sliceColor(slice, index) }} />
            <span className="truncate" title={slice.label}>
              {slice.label}
            </span>
            <span className="font-medium tabular-nums">{format(slice.value)}</span>
            <span className="text-right text-muted-foreground tabular-nums">{percent(slice.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, one per category, with the value at the tip. */
export function BarList({ data, format }: { data: Datum[]; format: (n: number) => string }) {
  const max = Math.max(...data.map((datum) => datum.value), 1);
  return (
    <ul className="flex flex-col gap-2 py-1">
      {data.map((datum) => (
        <li key={datum.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={datum.label}>
            {datum.label}
          </span>
          <span className="flex items-center gap-2">
            {datum.value > 0 && (
              <span
                className="h-3.5 rounded-r-[4px]"
                style={{ width: `calc((100% - 3rem) * ${datum.value / max})`, background: "var(--viz-series)" }}
              />
            )}
            <span className="tabular-nums">{format(datum.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ data, format, valueTitle, keyTitle }: { data: Datum[]; format: (n: number) => string; valueTitle: string; keyTitle: string }) {
  return (
    <div className="max-h-[220px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">{keyTitle}</th>
            <th className="py-1 text-right font-medium">{valueTitle}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key} className="border-t border-foreground/10">
              <td className="py-1">{datum.label}</td>
              <td className="py-1 text-right tabular-nums">{format(datum.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
