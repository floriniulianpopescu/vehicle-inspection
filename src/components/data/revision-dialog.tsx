import { useState, type FormEvent } from "react";
import { Field, FormError } from "@/components/data/field";
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
import { api, errorMessage, type RevisionPrompt } from "@/lib/api";
import { displayDate, fill, parseDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** Shown after an appointment is unticked, to correct the car's LastRevision. */
export function RevisionDialog({
  prompt,
  onClose,
  onSaved,
}: {
  prompt: RevisionPrompt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(prompt.lastRevision ? displayDate(prompt.lastRevision) : "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const revision = value.trim() ? parseDate(value) : null;
    if (value.trim() && !revision) {
      setError(t.data.errors.invalid_date);
      return;
    }
    try {
      await api.setLastRevision(prompt.carId, revision);
      onSaved();
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.data.revisionTitle}</DialogTitle>
          <DialogDescription>{fill(t.data.revisionText, { plate: prompt.plate })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t.data.lastRevision}>
            <Input
              value={value}
              placeholder={t.data.dateFormat}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </Field>
          {prompt.suggested && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue(displayDate(prompt.suggested as string))}
            >
              {fill(t.data.useSuggested, { date: displayDate(prompt.suggested) })}
            </Button>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.data.keepCurrent}
            </Button>
            <Button type="submit">{t.data.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
