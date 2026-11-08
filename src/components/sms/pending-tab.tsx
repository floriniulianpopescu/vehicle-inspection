import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SendIcon, SquareIcon } from "lucide-react";
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
import { displayDate, fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { sendingMinutes } from "@/lib/sms";

export function PendingTab() {
  const { t } = useI18n();
  const text = t.sms;
  const [items, setItems] = useState<PendingMessage[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .smsPending()
      .then(setItems)
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

  const sending = progress?.active ?? false;
  const selected = items.filter((item) => !skipped.has(item.key));
  const allSelected = items.length > 0 && selected.length === items.length;

  function toggle(key: string, checked: boolean) {
    setSkipped((previous) => {
      const next = new Set(previous);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSkipped(checked ? new Set() : new Set(items.map((item) => item.key)));
  }

  async function send() {
    setError(null);
    try {
      await api.smsSend(selected.map((item) => item.key));
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
            <Button variant="outline" onClick={() => void api.smsStop()}>
              <SquareIcon />
              {text.stop}
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              {selected.length > 1
                ? fill(text.estimate, {
                    count: selected.length,
                    minutes: sendingMinutes(selected.length),
                  })
                : ""}
            </span>
            <Button
              className="ml-auto"
              disabled={!configured || selected.length === 0}
              onClick={send}
            >
              <SendIcon />
              {fill(text.send, { count: selected.length })}
            </Button>
          </>
        )}
      </div>

      {!configured && <p className="text-sm text-muted-foreground">{text.notConfigured}</p>}
      <FormError message={error} />
      {progress && !progress.active && progress.total > 0 && (
        <p className="text-sm">
          {fill(text.finished, { sent: progress.sent, failed: progress.failed })}
        </p>
      )}
      {progress?.error && <FormError message={errorMessage(t, progress.error)} />}

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
            <TableHead>{text.type}</TableHead>
            <TableHead>{t.data.phone}</TableHead>
            <TableHead>{t.data.plate}</TableHead>
            <TableHead>{t.data.date}</TableHead>
            <TableHead>{text.message}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && <EmptyRow columns={6} />}
          {items.map((item) => (
            <TableRow key={item.key}>
              <TableCell>
                <Checkbox
                  aria-label={`${text.select} ${item.phone}`}
                  checked={!skipped.has(item.key)}
                  disabled={sending}
                  onCheckedChange={(checked) => toggle(item.key, checked === true)}
                />
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{text.kinds[item.kind]}</Badge>
              </TableCell>
              <TableCell>{item.phone}</TableCell>
              <TableCell className="font-medium">{item.plate ?? "-"}</TableCell>
              <TableCell>{displayDate(item.dueDate)}</TableCell>
              <TableCell className="whitespace-normal">{item.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
