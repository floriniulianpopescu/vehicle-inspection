import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ImageIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/date-range-picker";
import { Field, FormError } from "@/components/data/field";
import { ImagePicker } from "@/components/sms/image-picker";
import { PendingTab, type PendingMessages } from "@/components/sms/pending-tab";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, type CustomMessage } from "@/lib/api";
import { displayDate, fill, parseDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** Adds or changes a custom message: its name, text, period and picture. */
function CustomDialog({
  message,
  onClose,
  onSaved,
  onImageChanged,
}: {
  message: CustomMessage | null;
  onClose: () => void;
  onSaved: (id: number) => void;
  onImageChanged: () => void;
}) {
  const { t } = useI18n();
  const text = t.sms;
  const [name, setName] = useState(message?.name ?? "");
  const [body, setBody] = useState(message?.text ?? "");
  const [fromText, setFromText] = useState(message ? displayDate(message.from) : "");
  const [toText, setToText] = useState(message ? displayDate(message.to) : "");
  const [error, setError] = useState<string | null>(null);
  const from = parseDate(fromText);
  const to = parseDate(toText);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!from || !to || from > to) {
      setError(t.data.errors.invalid_date);
      return;
    }
    try {
      const id = await api.smsSaveCustomMessage({ id: message?.id ?? null, name, text: body, from, to });
      toast.success(text.customSaved);
      onSaved(id);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{message ? text.customEdit : text.customNew}</DialogTitle>
          <DialogDescription>{text.customNote}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={text.customName}>
            <Input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </Field>
          <Field label={text.customText}>
            <Textarea value={body} rows={4} onChange={(event) => setBody(event.target.value)} required />
            <span className="text-xs font-normal text-muted-foreground">{text.placeholdersPlate}</span>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm leading-none font-medium">{text.customPeriod}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-32"
                value={fromText}
                aria-label={`${text.customPeriod}: ${t.data.filters.from}`}
                aria-invalid={fromText.trim() !== "" && !from}
                placeholder={t.data.filters.from}
                onChange={(event) => setFromText(event.target.value)}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                className="w-32"
                value={toText}
                aria-label={`${text.customPeriod}: ${t.data.filters.to}`}
                aria-invalid={toText.trim() !== "" && !to}
                placeholder={t.data.filters.to}
                onChange={(event) => setToText(event.target.value)}
              />
              <DateRangePicker
                range={from && to ? { from, to } : null}
                onChange={(range) => {
                  setFromText(displayDate(range.from));
                  setToText(displayDate(range.to));
                }}
              />
            </div>
          </div>
          {message?.id != null ? (
            <ImagePicker
              image={message.image ?? null}
              onSave={async (data, mime) => {
                await api.smsSaveCustomImage(message.id as number, data, mime);
                onImageChanged();
              }}
              onRemove={async () => {
                await api.smsRemoveCustomImage(message.id as number);
                onImageChanged();
              }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{text.customImageAfterSave}</p>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.data.cancel}
            </Button>
            <Button type="submit">{t.data.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Custom messages: each is written for the cars inspected in a chosen period. One is chosen at a
 * time, and its recipients are listed below to send to.
 */
export function CustomTab({ shared }: { shared: PendingMessages }) {
  const { t } = useI18n();
  const text = t.sms;
  const [messages, setMessages] = useState<CustomMessage[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [editing, setEditing] = useState<CustomMessage | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { reload } = shared;

  const load = useCallback(
    (select?: number) =>
      api
        .smsCustomMessages()
        .then((next) => {
          setMessages(next);
          setChosen((current) => {
            const wanted = select ?? current;
            return next.some((message) => message.id === wanted) ? (wanted ?? null) : (next[0]?.id ?? null);
          });
          setError(null);
        })
        .catch((failure) => setError(errorMessage(t, failure))),
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const current = messages.find((message) => message.id === chosen) ?? null;

  async function remove(message: CustomMessage) {
    try {
      await api.smsDeleteCustomMessage(message.id as number);
      setDeleting(null);
      await load();
      reload();
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{text.customNote}</p>
      <div className="flex flex-wrap items-center gap-2">
        {messages.length > 0 && (
          <Select value={chosen === null ? "" : String(chosen)} onValueChange={(value) => setChosen(Number(value))}>
            <SelectTrigger className="w-80" aria-label={text.customChoose}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {messages.map((message) => (
                <SelectItem key={message.id} value={String(message.id)}>
                  {message.name} · {displayDate(message.from)} – {displayDate(message.to)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {current && (
          <>
            <Button variant="outline" onClick={() => setEditing(current)}>
              <PencilIcon />
              {text.customEdit}
            </Button>
            <Button variant="outline" onClick={() => setDeleting(current)}>
              <Trash2Icon />
              {text.customDelete}
            </Button>
          </>
        )}
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <PlusIcon />
          {text.customNew}
        </Button>
      </div>
      <FormError message={error} />

      {messages.length === 0 && <p className="text-sm text-muted-foreground">{text.customEmpty}</p>}
      {current && (
        <>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {fill(text.customSummary, { from: displayDate(current.from), to: displayDate(current.to) })}
            {current.image && <ImageIcon className="size-4" aria-label={text.withImage} />}
          </p>
          <PendingTab key={current.id} group="custom" customId={current.id} shared={shared} />
        </>
      )}

      {editing && (
        <CustomDialog
          message={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onImageChanged={() => {
            void load();
            reload();
          }}
          onSaved={(id) => {
            setEditing(null);
            void load(id);
            reload();
          }}
        />
      )}
      {deleting && (
        <Dialog open onOpenChange={() => setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{text.customDelete}</DialogTitle>
              <DialogDescription>{fill(text.customDeleteConfirm, { name: deleting.name })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {t.data.cancel}
              </Button>
              <Button variant="destructive" onClick={() => void remove(deleting)}>
                <Trash2Icon />
                {t.data.delete}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
