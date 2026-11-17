import { useEffect, useState, type ReactNode } from "react";
import { PencilIcon } from "lucide-react";
import { latestClient } from "@/components/data/car-dialog";
import { FormError } from "@/components/data/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errorMessage, type Car, type CarHistory } from "@/lib/api";
import { displayDate, displayDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatPhone } from "@/lib/romanian";

const STATE_BADGE = {
  ok: "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  other: "border-red-600/40 bg-red-500/15 text-red-800 dark:text-red-200",
} as const;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Everything about one car: its details, linked clients, every inspection and every message. */
export function CarDetailsDialog({
  car,
  onClose,
  onEdit,
}: {
  car: Car;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const text = t.data;
  const [history, setHistory] = useState<CarHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = latestClient(car);

  useEffect(() => {
    api
      .carHistory(car.carId)
      .then(setHistory)
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [car.carId, t]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {car.plate}
            <span className="ml-2 font-normal text-muted-foreground">
              {car.manufacturer} {car.model === "-" ? "" : car.model}
            </span>
          </DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Item label={text.lastRevision}>
            {car.lastRevision ? displayDate(car.lastRevision) : text.states.unknown}
          </Item>
          <Item label={text.nextRevision}>
            <span className="flex flex-wrap items-center gap-2">
              {car.nextRevision && displayDate(car.nextRevision)}
              <Badge variant="outline" className={STATE_BADGE[car.revisionState === "ok" ? "ok" : "other"]}>
                {text.states[car.revisionState]}
              </Badge>
            </span>
          </Item>
          <Item label={text.frequency}>{text.months[car.revisionFrequency]}</Item>
          <Item label={text.linkedClients}>
            {car.clients.length === 0 ? (
              "-"
            ) : (
              <ul className="flex flex-col gap-0.5">
                {[...car.clients]
                  .sort((a, b) => (a.id === latest?.id ? -1 : b.id === latest?.id ? 1 : b.id - a.id))
                  .map((client) => (
                    <li key={client.id} className="flex items-center gap-2">
                      {formatPhone(client.label)}
                      {client.id === latest?.id && car.clients.length > 1 && (
                        <Badge variant="secondary">{text.latestNumber}</Badge>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </Item>
          <Item label={text.feedback}>{car.feedback ? text.yes : text.no}</Item>
          <Item label={text.addedOn}>
            {car.createdAt ? displayDateTime(car.createdAt) : "-"}
          </Item>
          <Item label={text.editedOn}>
            {car.updatedAt ? displayDateTime(car.updatedAt.slice(0, 19)) : "-"}
          </Item>
          <div className="col-span-full">
            <Item label={text.notes}>
              <span className="whitespace-pre-wrap">{car.notes || "-"}</span>
            </Item>
          </div>
        </dl>

        <FormError message={error} />

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {text.inspectionHistory}
            {history && <span className="ml-1 font-normal text-muted-foreground">({history.inspections.length})</span>}
          </h3>
          {history && history.inspections.length === 0 && (
            <p className="text-sm text-muted-foreground">{text.noInspections}</p>
          )}
          {history && history.inspections.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {history.inspections.map((entry) => (
                <li key={entry.date} className="flex justify-between gap-4 px-3 py-1.5">
                  <span className="font-medium">{displayDate(entry.date)}</span>
                  <span className="text-muted-foreground">
                    {entry.phone ? formatPhone(entry.phone) : text.unknownClient}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {history && history.messages.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {text.messageHistory}
              <span className="ml-1 font-normal text-muted-foreground">({history.messages.length})</span>
            </h3>
            <ul className="divide-y rounded-md border text-sm">
              {history.messages.map((message, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1.5">
                  <span className="font-medium">{displayDateTime(message.sentAt)}</span>
                  <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    {t.sms.kinds[message.kind]} · {t.sms.channels[message.channel]} · {formatPhone(message.phone)}
                    <Badge variant={message.status === "sent" ? "outline" : "destructive"}>
                      {t.sms.statuses[message.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {text.close}
          </Button>
          <Button onClick={onEdit}>
            <PencilIcon />
            {text.edit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
