import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SendIcon, SquareIcon } from "lucide-react";
import { DaysInput } from "@/components/days-input";
import { FormError } from "@/components/data/field";
import { EmptyRow } from "@/components/data/table-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, errorMessage, type PendingMessage, type SendProgress } from "@/lib/api";
import { displayDate, fill, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import {
  clampInterval,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  sendingSeconds,
  splitDuration,
} from "@/lib/sms";

type Filter = "all" | "expiring" | "expired";
const FILTERS: Filter[] = ["all", "expiring", "expired"];
export type Channel = PendingMessage["channel"];

/** Expired means the ITP date has passed. */
function matches(item: PendingMessage, filter: Filter, today: string): boolean {
  if (filter === "all") return true;
  return filter === "expired" ? item.dueDate < today : item.dueDate >= today;
}

/**
 * Messages waiting for one channel: ITP reminders by SMS, or greetings by WhatsApp. Each
 * channel has its own list, pause and Send button; only one batch runs at a time.
 */
export function PendingTab({ channel }: { channel: Channel }) {
  const { t } = useI18n();
  const text = t.sms;
  const isSms = channel === "sms";
  const [all, setAll] = useState<PendingMessage[]>([]);
  const items = all.filter((item) => item.channel === channel);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [progress, setProgress] = useState<SendProgress | null>(null);
  // Stop finishes or drops the message in progress, which can take a few seconds.
  const [stopping, setStopping] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [days, setDays] = useState<number | null>(null);
  const [intervalText, setIntervalText] = useState(String(MIN_INTERVAL_SECONDS));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .smsPending()
      .then(setAll)
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [t]);

  useEffect(() => {
    reload();
    api
      .smsReminderDays()
      .then(setDays)
      .catch(() => {});
    api
      .smsIntervalSeconds(channel)
      .then((seconds) => setIntervalText(String(seconds)))
      .catch(() => {});
    api.smsProgress().then(setProgress).catch(() => {});
    api
      .smsGatewaySettings()
      .then((settings) =>
        setConfigured(Boolean(settings.address && settings.username && settings.hasPassword)),
      )
      .catch(() => setConfigured(false));
  }, [reload, channel]);

  useEffect(() => {
    const stop = listen<SendProgress>("sms-progress", (event) => {
      setProgress(event.payload);
      if (!event.payload.active) {
        setStopping(false);
        reload();
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [reload]);

  const sending = progress?.active ?? false;
  // Only what the filter shows is selected and sent.
  const today = todayIso();
  const counts: Record<Filter, number> = {
    all: items.length,
    expiring: items.filter((item) => matches(item, "expiring", today)).length,
    expired: items.filter((item) => matches(item, "expired", today)).length,
  };
  const visible = isSms ? items.filter((item) => matches(item, filter, today)) : items;
  const selected = visible.filter((item) => !skipped.has(item.key));
  const allSelected = visible.length > 0 && selected.length === visible.length;

  function toggle(key: string, checked: boolean) {
    setSkipped((previous) => {
      const next = new Set(previous);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSkipped((previous) => {
      const next = new Set(previous);
      for (const item of visible) {
        if (checked) next.delete(item.key);
        else next.add(item.key);
      }
      return next;
    });
  }

  async function changeDays(next: number) {
    setError(null);
    try {
      await api.smsSetReminderDays(next);
      setDays(next);
      reload();
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  // ITP reminders need the SMS phone; greetings go through WhatsApp, checked when sending.
  const needsPhone = isSms && !configured;

  // The estimate follows the field as it is typed; below the minimum it counts the minimum.
  const typedInterval = Number.parseInt(intervalText, 10);
  const intervalTooShort = !Number.isNaN(typedInterval) && typedInterval < MIN_INTERVAL_SECONDS;
  const interval = clampInterval(intervalText) ?? MIN_INTERVAL_SECONDS;
  const duration = splitDuration(sendingSeconds(selected.length, interval));
  const durationText =
    selected.length <= 1
      ? text.rightAway
      : [
          duration.hours > 0 && `${duration.hours} ${text.units.hours}`,
          (duration.hours > 0 || duration.minutes > 0) && `${duration.minutes} ${text.units.minutes}`,
          `${duration.seconds} ${text.units.seconds}`,
        ]
          .filter(Boolean)
          .join(" ");

  async function send() {
    setError(null);
    setIntervalText(String(interval));
    try {
      await api.smsSend(
        selected.map((item) => item.key),
        interval,
      );
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {sending && progress ? (
          <>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-sm font-medium">
                {fill(text.progress, { done: progress.done, total: progress.total })}
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{text.keepOpen}</span>
            </div>
            <Button
              variant="outline"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                void api.smsStop();
              }}
            >
              <SquareIcon />
              {stopping ? text.stopping : text.stop}
            </Button>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <span>{text.interval}</span>
              <Input
                className="w-24"
                type="number"
                inputMode="numeric"
                min={MIN_INTERVAL_SECONDS}
                max={MAX_INTERVAL_SECONDS}
                value={intervalText}
                aria-invalid={intervalTooShort}
                onChange={(event) => setIntervalText(event.target.value)}
                onBlur={() => setIntervalText(String(interval))}
              />
              <span>{text.units.seconds}</span>
            </label>
            <span
              className={`text-sm ${intervalTooShort ? "text-destructive" : "text-muted-foreground"}`}
              aria-live="polite"
            >
              {intervalTooShort
                ? text.intervalMinimum
                : selected.length === 1
                  ? text.estimateOne
                  : selected.length > 1 &&
                    fill(text.estimate, { count: selected.length, duration: durationText })}
            </span>
            <Button
              className="ml-auto"
              disabled={needsPhone || selected.length === 0}
              title={isSms ? text.channels.sms : text.channels.whatsapp}
              onClick={send}
            >
              <SendIcon />
              {fill(text.send, { count: selected.length })}
            </Button>
          </>
        )}
      </div>

      {isSms && days !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DaysInput label={text.reminderDays} value={days} onCommit={changeDays} />
          <span className="text-xs text-muted-foreground">{text.daysHint}</span>
        </div>
      )}
      {needsPhone && <p className="text-sm text-muted-foreground">{text.notConfigured}</p>}
      {!isSms && <p className="text-sm text-muted-foreground">{text.whatsappNote}</p>}
      <FormError message={error} />
      {progress && !progress.active && progress.total > 0 && (
        <p className="text-sm">
          {fill(text.finished, { sent: progress.sent, failed: progress.failed })}
        </p>
      )}
      {progress?.error && <FormError message={errorMessage(t, progress.error)} />}

      {isSms && (
        <div role="radiogroup" aria-label={text.filterLabel} className="flex flex-wrap gap-1">
          {FILTERS.map((value) => (
            <Button
              key={value}
              role="radio"
              aria-checked={filter === value}
              variant={filter === value ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(value)}
            >
              {text.filters[value]}
              <Badge variant="secondary">{counts[value]}</Badge>
            </Button>
          ))}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label={text.selectAll}
                checked={allSelected}
                disabled={sending}
                onCheckedChange={(checked) => toggleAll(checked === true)}
              />
            </TableHead>
            {!isSms && <TableHead>{text.type}</TableHead>}
            <TableHead>{t.data.phone}</TableHead>
            {isSms && <TableHead>{t.data.plate}</TableHead>}
            <TableHead>{isSms ? t.data.nextRevision : t.data.date}</TableHead>
            <TableHead>{text.message}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 && <EmptyRow columns={5} />}
          {visible.map((item) => (
            <TableRow key={item.key}>
              <TableCell>
                <Checkbox
                  aria-label={`${text.select} ${item.phone}`}
                  checked={!skipped.has(item.key)}
                  disabled={sending}
                  onCheckedChange={(checked) => toggle(item.key, checked === true)}
                />
              </TableCell>
              {!isSms && (
                <TableCell>
                  <Badge variant="secondary">{text.kinds[item.kind]}</Badge>
                </TableCell>
              )}
              <TableCell>{item.phone}</TableCell>
              {isSms && <TableCell className="font-medium">{item.plate ?? "-"}</TableCell>}
              <TableCell>{displayDate(item.dueDate)}</TableCell>
              <TableCell className="whitespace-normal">{item.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
