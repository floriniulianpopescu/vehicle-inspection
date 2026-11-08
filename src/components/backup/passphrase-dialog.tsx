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
import { api, errorMessage, type BackupStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function PassphraseDialog({
  replacing,
  onClose,
  onSaved,
}: {
  replacing: boolean;
  onClose: () => void;
  onSaved: (status: BackupStatus) => void;
}) {
  const { t } = useI18n();
  const text = t.settings.backup;
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (passphrase !== repeat) {
      setError(text.passphraseMismatch);
      return;
    }
    setSaving(true);
    try {
      onSaved(await api.backupSetPassphrase(passphrase));
    } catch (failure) {
      setError(errorMessage(t, failure));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text.passphrase}</DialogTitle>
          <DialogDescription>
            {text.passphraseWarning} {replacing && text.passphraseReplaceWarning}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={text.newPassphrase}>
            <Input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label={text.repeatPassphrase}>
            <Input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.data.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {t.data.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
