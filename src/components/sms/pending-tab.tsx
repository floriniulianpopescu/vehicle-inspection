import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ImageIcon, SendIcon, SquareIcon } from "lucide-react";
import { DaysInput } from "@/components/days-input";
import { FormError } from "@/components/data/field";
import { ShowMore, useShowMore } from "@/components/show-more";
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
import { displayDate, displayDateTime, fill, todayIso } from "@/lib/format";
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
type StatusFilter = "all" | "unsent" | "failed" | "sent";
const STATUS_FILTERS: StatusFilter[] = ["all", "unsent", "failed", "sent"];

/**
 * The message lists of the Auto SMS page. ITP reminders go by WhatsApp first; whoever
 * WhatsApp fails then appears in the SMS list. Greetings and feedback go by WhatsApp.
 */
export type Group = "remindersWhatsapp" | "remindersSms" | "greetings" | "feedback";

function groupOf(item: PendingMessage): Group {
  if (item.kind === "inspection") return item.channel === "sms" ? "remindersSms" : "remindersWhatsapp";
  if (item.kind === "feedback") return "feedback";
  return "greetings";
}

/** Expired means the ITP date has passed. */
function matches(item: PendingMessage, filter: Filter, today: string): boolean {
  if (filter === "all") return true;
  return filter === "expired" ? item.dueDate < today : item.dueDate >= today;
}

const STATUS_STYLE: Record<PendingMessage["status"], string> = {
  unsent: "",
  sent: "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  failed: "border-red-600/40 bg-red-500/15 text-red-800 dark:text-red-200",
};

/**
 * What the Auto SMS page loads once and shares with its message tabs: every message of the
 * current round, whether the SMS phone is set up, and the progress of the running batch.
 */
export function usePendingMessages() {
  const { t } = useI18n();
  const [all, setAll] = useState<PendingMessage[]>([]);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .smsPending()
      .then((next) => {
        setAll(next);
        setError(null);
      })
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [t]);

  useEffect(() => {
    reload();
    api.smsProgress().then(setProgress).catch(() => {});
    api
      .smsGatewaySettings()
      .then((settings) =>
        setConfigured(Boolean(settings.address && settings.username && settings.hasPassword)),
      )
      .catch(() => setConfigured(false));
  }, [reload]);

  useEffect(() => {
    const stop = listen<SendProgress>("sms-progress", (event) => {
      setProgress(event.payload);
      if (!event.payload.active) reload();
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [reload]);

  return { all, reload, progress, configured, error };
}

export type PendingMessages = ReturnType<typeof usePendingMessages>;

/**
 * One list of messages with its own Send button; only one batch runs at a time. Every message
 * of the current round is listed with its status, so a failed or already sent one can be sent
 * again. Sent ones start unticked, so "select all" does not repeat them by accident.
 */
export function PendingTab({ group, shared }: { group: Group; shared: PendingMessages }) {
  const { t } = useI18n();
  const text = t.sms;
  const isSms = group === "remindersSms";
  const isReminder = group === "remindersSms" || group === "remindersWhatsapp";
  const channel = isSms ? "sms" : "whatsapp";
  const { all, reload, progress, configured } = shared;
  const items = all.filter((item) => groupOf(item) === group);
  // Ticks the person changed; everything else follows its status.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Stop finishes or drops the message in progress, which can take a few seconds.
  const [stopping, setStopping] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const [intervalText, setIntervalText] = useState(String(MIN_INTERVAL_SECONDS));
  const [ownError, setError] = useState<string | null>(null);
  const error = ownError ?? shared.error;

  useEffect(() => {
    if (isReminder) {
      api
        .smsReminderDays()
        .then(setDays)
        .catch(() => {});
    }
    api
      .smsIntervalSeconds(channel)
      .then((seconds) => setIntervalText(String(seconds)))
      .catch(() => {});
  }, [isReminder, channel]);

  useEffect(() => {
    if (!progress?.active) setStopping(false);
  }, [progress?.active]);

  // After a send the statuses change, so the default ticks apply again.
  useEffect(() => setOverrides(new Map()), [all]);

  const sending = progress?.active ?? false;
  const today = todayIso();
  const isChecked = (item: PendingMessage) => overrides.get(item.key) ?? item.status !== "sent";
  const dueMatching = isReminder ? items.filter((item) => matches(item, filter, today)) : items;
  const counts: Record<Filter, number> = {
    all: items.length,
    expiring: items.filter((item) => matches(item, "expiring", today)).length,
    expired: items.filter((item) => matches(item, "expired", today)).length,
  };
  const statusCounts: Record<StatusFilter, number> = {
    all: dueMatching.length,
    unsent: dueMatching.filter((item) => item.status === "unsent").length,
    failed: dueMatching.filter((item) => item.status === "failed").length,
    sent: dueMatching.filter((item) => item.status === "sent").length,
  };
  // Only what the filters show is selected and sent.
  const visible =
    statusFilter === "all" ? dueMatching : dueMatching.filter((item) => item.status === statusFilter);
  const selected = visible.filter(isChecked);
  const allSelected = visible.length > 0 && selected.length === visible.length;
  // Only the drawing is limited; selecting and sending use the whole list.
  const { shown, hidden, more } = useShowMore(visible, `${filter}|${statusFilter}|${all.length}`);

  function toggle(key: string, checked: boolean) {
    setOverrides((previous) => new Map(previous).set(key, checked));
  }

  function toggleAll(checked: boolean) {
    setOverrides((previous) => {
      const next = new Map(previous);
      for (const item of visible) next.set(item.key, checked);
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

  // Only the SMS list needs the phone; WhatsApp is checked when sending.
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

  const note =
    group === "remindersWhatsapp"
      ? text.remindersWhatsappNote
      : group === "remindersSms"
        ? text.remindersSmsNote
        : group === "feedback"
          ? text.feedbackNote
          : null;

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

      {isReminder && days !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DaysInput label={text.reminderDays} value={days} onCommit={changeDays} />
          <span className="text-xs text-muted-foreground">{text.daysHint}</span>
        </div>
      )}
      {needsPhone && <p className="text-sm text-muted-foreground">{text.notConfigured}</p>}
      {note && <p className="text-sm">{note}</p>}
      {!isSms && <p className="text-sm text-muted-foreground">{text.whatsappNote}</p>}
      <FormError message={error} />
      {progress && !progress.active && progress.total > 0 && (
        <p className="text-sm">
          {fill(text.finished, { sent: progress.sent, failed: progress.failed })}
        </p>
      )}
      {progress?.error && <FormError message={errorMessage(t, progress.error)} />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {isReminder && (
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
        <div role="radiogroup" aria-label={text.status} className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((value) => (
            <Button
              key={value}
              role="radio"
              aria-checked={statusFilter === value}
              variant={statusFilter === value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(value)}
            >
              {text.statusFilters[value]}
              <Badge variant="secondary">{statusCounts[value]}</Badge>
            </Button>
          ))}
        </div>
      </div>

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
            <TableHead>{text.status}</TableHead>
            {group === "greetings" && <TableHead>{text.type}</TableHead>}
            <TableHead>{t.data.phone}</TableHead>
            {group !== "greetings" && <TableHead>{t.data.plate}</TableHead>}
            <TableHead>{isReminder ? t.data.nextRevision : t.data.date}</TableHead>
            <TableHead>{text.message}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 && <EmptyRow columns={6} />}
          {shown.map((item) => (
            <TableRow key={item.key}>
              <TableCell>
                <Checkbox
                  aria-label={`${text.select} ${item.phone}`}
                  checked={isChecked(item)}
                  disabled={sending}
                  onCheckedChange={(checked) => toggle(item.key, checked === true)}
                />
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-0.5">
                  <Badge variant="outline" className={STATUS_STYLE[item.status]}>
                    {text.statuses[item.status]}
                  </Badge>
                  {item.lastAttempt && (
                    <span className="text-xs text-muted-foreground">{displayDateTime(item.lastAttempt)}</span>
                  )}
                </span>
              </TableCell>
              {group === "greetings" && (
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <Badge variant="secondary">{text.kinds[item.kind]}</Badge>
                    {item.hasImage && (
                      <ImageIcon className="size-4 text-muted-foreground" aria-label={text.withImage} />
                    )}
                  </span>
                </TableCell>
              )}
              <TableCell>{item.phone}</TableCell>
              {group !== "greetings" && (
                <TableCell className="font-medium">{item.plate ?? "-"}</TableCell>
              )}
              <TableCell>{displayDate(item.dueDate)}</TableCell>
              <TableCell className="whitespace-normal">{item.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ShowMore hidden={hidden} onMore={more} />
    </div>
  );
}
