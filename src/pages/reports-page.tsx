import { useEffect, useMemo, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/data/field";
import { DueTab, LoadTab, OverviewTab, ScheduleTab } from "@/components/reports/report-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, type Report, type ReportExportLabels, type ReportRequest } from "@/lib/api";
import { loadCalendarSettings } from "@/lib/calendar";
import { displayDate, fill, parseDate, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { monthRange, weekRange, type DateRange } from "@/lib/reports";
import type { Messages } from "@/locales/ro";

function exportLabels(t: Messages): ReportExportLabels {
  const text = t.reports;
  return {
    sheetOverview: text.sheets.overview,
    sheetSchedule: text.sheets.schedule,
    sheetLoad: text.sheets.load,
    sheetDue: text.sheets.due,
    title: text.title,
    period: text.period,
    generatedAt: text.generatedAt,
    appointments: text.appointments,
    completedOfPast: text.completedOfPast,
    completionRate: text.completionRate,
    overdueCars: text.overdueCars,
    messagesSent: text.messagesSent,
    bookedHours: text.bookedHours,
    appointmentsPerDay: text.appointmentsPerDay,
    bookedPerDay: text.bookedPerDay,
    date: t.data.date,
    weekday: text.weekday,
    time: t.data.time,
    durationMinutes: t.data.duration,
    plate: t.data.plate,
    manufacturer: t.data.manufacturer,
    model: t.data.model,
    phone: t.data.phone,
    done: t.data.done,
    yes: text.yes,
    no: text.no,
    workingHours: text.workingHours,
    loadPercent: text.loadPercent,
    status: text.status,
    overbooked: text.overbooked,
    withinCapacity: text.withinCapacity,
    stateLabel: {
      overdue: t.data.states.overdue,
      soon: t.data.states.soon,
      unknown: t.data.states.unknown,
    },
    lastRevision: t.data.lastRevision,
    nextRevision: t.data.nextRevision,
    phones: text.phones,
    weekdays: text.weekdays,
  };
}

export function ReportsPage() {
  const { t } = useI18n();
  const text = t.reports;
  const today = todayIso();
  const initial = weekRange(today);
  const [fromText, setFromText] = useState(displayDate(initial.from));
  const [toText, setToText] = useState(displayDate(initial.to));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const request = useMemo<ReportRequest | null>(() => {
    const from = parseDate(fromText);
    const to = parseDate(toText);
    if (!from || !to || from > to) return null;
    const { days, startHour, endHour } = loadCalendarSettings();
    return { from, to, workingDays: days, startHour, endHour };
  }, [fromText, toText]);

  useEffect(() => {
    if (!request) {
      setError(t.data.errors.invalid_date);
      return;
    }
    let current = true;
    api
      .report(request)
      .then((next) => {
        if (!current) return;
        setReport(next);
        setError(null);
      })
      .catch((failure) => {
        if (current) setError(errorMessage(t, failure));
      });
    return () => {
      current = false;
    };
  }, [request, t]);

  function choose(range: DateRange) {
    setFromText(displayDate(range.from));
    setToText(displayDate(range.to));
  }

  async function exportFile() {
    if (!request) return;
    setExporting(true);
    try {
      const fileName = `${text.fileName}-${request.from}-${request.to}.xlsx`;
      const saved = await api.exportReport(request, exportLabels(t), fileName);
      if (saved) toast.success(fill(text.exported, { path: saved }));
    } catch (failure) {
      toast.error(errorMessage(t, failure));
    } finally {
      setExporting(false);
    }
  }

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
        <Button variant="outline" onClick={() => choose({ from: today, to: today })}>
          {text.today}
        </Button>
        <Button variant="outline" onClick={() => choose(weekRange(today))}>
          {text.thisWeek}
        </Button>
        <Button variant="outline" onClick={() => choose(monthRange(today))}>
          {text.thisMonth}
        </Button>
        <Button className="ml-auto" disabled={!request || exporting} onClick={exportFile}>
          <DownloadIcon />
          {exporting ? text.exporting : text.export}
        </Button>
      </div>

      <FormError message={error} />

      {report && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{text.tabs.overview}</TabsTrigger>
            <TabsTrigger value="schedule">
              {text.tabs.schedule} <Badge variant="secondary">{report.schedule.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="load">{text.tabs.load}</TabsTrigger>
            <TabsTrigger value="due">
              {text.tabs.due} <Badge variant="secondary">{report.due.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab report={report} />
          </TabsContent>
          <TabsContent value="schedule">
            <ScheduleTab report={report} />
          </TabsContent>
          <TabsContent value="load">
            <LoadTab report={report} />
          </TabsContent>
          <TabsContent value="due">
            <DueTab report={report} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
