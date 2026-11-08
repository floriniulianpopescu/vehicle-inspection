import { Fragment, type ReactNode } from "react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { STATE_VARIANT } from "@/components/data/cars-tab";
import { EmptyRow } from "@/components/data/table-parts";
import { DayBars } from "@/components/reports/day-bars";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Report } from "@/lib/api";
import { displayDate, fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { hoursText } from "@/lib/reports";

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-heading text-3xl font-semibold tabular-nums">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}

function Swatch({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={`inline-block ${className ?? ""}`} style={style} />;
}

function ChartCard({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {children}
        {legend && (
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">{legend}</div>
        )}
      </CardContent>
    </Card>
  );
}

function useLocale() {
  const { language } = useI18n();
  return language === "ro" ? "ro-RO" : "en-GB";
}

export function OverviewTab({ report }: { report: Report }) {
  const { t } = useI18n();
  const text = t.reports;
  const locale = useLocale();
  const { overview, load } = report;
  const rate =
    overview.completionRate === null
      ? "-"
      : new Intl.NumberFormat(locale, { style: "percent" }).format(overview.completionRate);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label={text.appointments} value={String(overview.appointments)} />
        <StatTile
          label={text.completionRate}
          value={rate}
          hint={
            overview.past > 0
              ? fill(text.completionDetail, { completed: overview.completed, past: overview.past })
              : text.noPast
          }
        />
        <StatTile
          label={text.bookedHours}
          value={hoursText(overview.bookedMinutes, locale)}
        />
        <StatTile
          label={text.overdueCars}
          value={String(overview.overdueCars)}
          hint={text.overdueHint}
        />
        <StatTile label={text.messagesSent} value={String(overview.messagesSent)} />
      </div>

      {load.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={text.appointmentsPerDay}>
            <DayBars
              label={text.appointmentsPerDay}
              locale={locale}
              bars={load.map((day) => ({
                date: day.date,
                value: day.appointments,
                details: [`${text.appointments}: ${day.appointments}`],
              }))}
            />
          </ChartCard>
          <ChartCard
            title={text.bookedPerDay}
            legend={
              <>
                <span className="flex items-center gap-1.5">
                  <Swatch className="size-2.5 rounded-sm" style={{ background: "var(--viz-series)" }} />
                  {text.bookedHours}
                </span>
                <span className="flex items-center gap-1.5">
                  <Swatch className="h-0.5 w-3 bg-foreground" />
                  {text.workingHours}
                </span>
                <span className="flex items-center gap-1.5">
                  <Swatch className="size-2.5 rounded-sm" style={{ background: "var(--viz-alert)" }} />
                  {text.overbooked}
                </span>
              </>
            }
          >
            <DayBars
              label={text.bookedPerDay}
              locale={locale}
              bars={load.map((day) => ({
                date: day.date,
                value: day.bookedMinutes / 60,
                limit: day.capacityMinutes / 60,
                alert: day.overbooked,
                details: [
                  `${text.bookedHours}: ${hoursText(day.bookedMinutes, locale)}`,
                  `${text.workingHours}: ${hoursText(day.capacityMinutes, locale)}`,
                  ...(day.overbooked ? [text.overbooked] : []),
                ],
              }))}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

export function ScheduleTab({ report }: { report: Report }) {
  const { t } = useI18n();
  const text = t.reports;
  const columns = 7;
  const days = [...new Set(report.schedule.map((row) => row.date))];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.data.time}</TableHead>
          <TableHead>{t.data.duration}</TableHead>
          <TableHead>{t.data.plate}</TableHead>
          <TableHead>{t.data.manufacturer}</TableHead>
          <TableHead>{t.data.model}</TableHead>
          <TableHead>{t.data.phone}</TableHead>
          <TableHead>{t.data.done}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.length === 0 && <EmptyRow columns={columns} />}
        {days.map((day) => (
          <Fragment key={day}>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableCell colSpan={columns} className="font-medium">
                {displayDate(day)}
              </TableCell>
            </TableRow>
            {report.schedule
              .filter((row) => row.date === day)
              .map((row) => (
                <TableRow key={row.appointmentId}>
                  <TableCell>{row.time}</TableCell>
                  <TableCell>{row.duration}</TableCell>
                  <TableCell className="font-medium">{row.plate}</TableCell>
                  <TableCell>{row.manufacturer}</TableCell>
                  <TableCell>{row.model}</TableCell>
                  <TableCell>{row.phone}</TableCell>
                  <TableCell>
                    {row.isDone ? (
                      <span className="flex items-center gap-1">
                        <CheckIcon className="size-4" />
                        {text.yes}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{text.no}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export function LoadTab({ report }: { report: Report }) {
  const { t } = useI18n();
  const text = t.reports;
  const locale = useLocale();
  const percent = new Intl.NumberFormat(locale, { style: "percent" });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.data.date}</TableHead>
          <TableHead>{text.weekday}</TableHead>
          <TableHead>{text.appointments}</TableHead>
          <TableHead>{text.bookedHours}</TableHead>
          <TableHead>{text.workingHours}</TableHead>
          <TableHead>{text.loadPercent}</TableHead>
          <TableHead>{text.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.load.length === 0 && <EmptyRow columns={7} />}
        {report.load.map((day) => (
          <TableRow key={day.date}>
            <TableCell>{displayDate(day.date)}</TableCell>
            <TableCell>{text.weekdays[day.weekday]}</TableCell>
            <TableCell>{day.appointments}</TableCell>
            <TableCell>{hoursText(day.bookedMinutes, locale)}</TableCell>
            <TableCell>{hoursText(day.capacityMinutes, locale)}</TableCell>
            <TableCell>
              {day.capacityMinutes > 0 ? percent.format(day.bookedMinutes / day.capacityMinutes) : "-"}
            </TableCell>
            <TableCell>
              {day.overbooked ? (
                <Badge variant="destructive">
                  <TriangleAlertIcon />
                  {text.overbooked}
                </Badge>
              ) : (
                <span className="text-muted-foreground">{text.withinCapacity}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DueTab({ report }: { report: Report }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t.reports.dueHint}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.reports.status}</TableHead>
            <TableHead>{t.data.plate}</TableHead>
            <TableHead>{t.data.manufacturer}</TableHead>
            <TableHead>{t.data.model}</TableHead>
            <TableHead>{t.data.lastRevision}</TableHead>
            <TableHead>{t.data.nextRevision}</TableHead>
            <TableHead>{t.reports.phones}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.due.length === 0 && <EmptyRow columns={7} />}
          {report.due.map((car) => (
            <TableRow key={car.carId}>
              <TableCell>
                <Badge variant={STATE_VARIANT[car.state]}>{t.data.states[car.state]}</Badge>
              </TableCell>
              <TableCell className="font-medium">{car.plate}</TableCell>
              <TableCell>{car.manufacturer}</TableCell>
              <TableCell>{car.model}</TableCell>
              <TableCell>{car.lastRevision ? displayDate(car.lastRevision) : "-"}</TableCell>
              <TableCell>{car.nextRevision ? displayDate(car.nextRevision) : "-"}</TableCell>
              <TableCell>{car.phones || "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
