import { useEffect, useMemo, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { DaysInput } from "@/components/days-input";
import { FormError } from "@/components/data/field";
import { DateRangePicker } from "@/components/date-range-picker";
import { DueTab, InspectedTab, RepeatTab } from "@/components/reports/report-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  errorMessage,
  MAX_EXPIRING_DAYS,
  type Report,
  type ReportExportLabels,
  type ReportRequest,
} from "@/lib/api";
import { displayDate, fill, parseDate, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { monthRange, weekRange, yearRange, type DateRange } from "@/lib/reports";
import type { Messages } from "@/locales/ro";

const DAYS_KEY = "report-expiring-days";
const DEFAULT_DAYS = 30;

function storedDays(): number {
  try {
    const value = Number(localStorage.getItem(DAYS_KEY));
    return Number.isInteger(value) && value >= 1 && value <= MAX_EXPIRING_DAYS ? value : DEFAULT_DAYS;
  } catch {
    return DEFAULT_DAYS;
  }
}

function exportLabels(t: Messages): ReportExportLabels {
  const text = t.reports;
  return {
    sheetInspected: text.sheets.inspected,
    sheetExpiring: text.sheets.expiring,
    sheetExpired: text.sheets.expired,
    sheetRepeatCars: text.sheets.repeatCars,
    sheetRepeatClients: text.sheets.repeatClients,
    date: t.data.date,
    plate: t.data.plate,
    manufacturer: t.data.manufacturer,
    model: t.data.model,
    broughtBy: text.broughtBy,
    phone: t.data.phone,
    phones: text.phones,
    lastRevision: t.data.lastRevision,
    nextRevision: t.data.nextRevision,
    daysLeft: text.daysLeft,
    daysOverdue: text.daysOverdue,
    visits: text.visits,
    firstVisit: text.firstVisit,
    lastVisit: text.lastVisit,
    plates: text.plates,
  };
}

export function ReportsPage() {
  const { t } = useI18n();
  const text = t.reports;
  const today = todayIso();
  const initial = monthRange(today);
  const [fromText, setFromText] = useState(displayDate(initial.from));
  const [toText, setToText] = useState(displayDate(initial.to));
  const [days, setDays] = useState(storedDays);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = useMemo<DateRange | null>(() => {
    const from = parseDate(fromText);
    const to = parseDate(toText);
    return from && to && from <= to ? { from, to } : null;
  }, [fromText, toText]);

  const request = useMemo<ReportRequest | null>(
    () => (range ? { ...range, expiringDays: days } : null),
    [range, days],
  );

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

  function choose(next: DateRange) {
    setFromText(displayDate(next.from));
    setToText(displayDate(next.to));
  }

  function changeDays(next: number) {
    setDays(next);
    try {
      localStorage.setItem(DAYS_KEY, String(next));
    } catch {
      // Kept for this session only.
    }
  }

  async function exportFile() {
    if (!request) return;
    setExporting(true);
    try {
      const fileName = `${text.fileName}-${today}.xlsx`;
      const saved = await api.exportReport(request, exportLabels(t), fileName);
      if (saved) toast.success(fill(text.exported, { path: saved }));
    } catch (failure) {
      toast.error(errorMessage(t, failure));
    } finally {
      setExporting(false);
    }
  }

  const periodControls = (
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
      <Button variant="outline" onClick={() => choose({ from: today, to: today })}>
        {text.today}
      </Button>
      <Button variant="outline" onClick={() => choose(weekRange(today))}>
        {text.thisWeek}
      </Button>
      <Button variant="outline" onClick={() => choose(monthRange(today))}>
        {text.thisMonth}
      </Button>
      <Button variant="outline" onClick={() => choose(yearRange(today))}>
        {text.thisYear}
      </Button>
    </div>
  );

  const count = (value: number) => <Badge variant="secondary">{value}</Badge>;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <FormError message={error} />

      {report && (
        <Tabs defaultValue="inspected">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="inspected">
                {text.tabs.inspected} {count(report.inspected.length)}
              </TabsTrigger>
              <TabsTrigger value="expiring">
                {text.tabs.expiring} {count(report.expiring.length)}
              </TabsTrigger>
              <TabsTrigger value="expired">
                {text.tabs.expired} {count(report.expired.length)}
              </TabsTrigger>
              <TabsTrigger value="repeat">
                {text.tabs.repeat} {count(report.repeatCars.length + report.repeatClients.length)}
              </TabsTrigger>
            </TabsList>
            <Button className="ml-auto" disabled={!request || exporting} onClick={exportFile}>
              <DownloadIcon />
              {exporting ? text.exporting : text.export}
            </Button>
          </div>
          <TabsContent value="inspected">
            <InspectedTab report={report} controls={periodControls} />
          </TabsContent>
          <TabsContent value="expiring">
            <DueTab
              rows={report.expiring}
              expired={false}
              hint={text.expiringHint}
              controls={<DaysInput label={text.expiringWithin} value={days} onCommit={changeDays} />}
            />
          </TabsContent>
          <TabsContent value="expired">
            <DueTab rows={report.expired} expired hint={text.expiredHint} />
          </TabsContent>
          <TabsContent value="repeat">
            <RepeatTab report={report} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
