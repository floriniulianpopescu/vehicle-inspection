import { useEffect, useState, type FormEvent } from "react";
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
import { api, errorMessage, type RemoteBackup } from "@/lib/api";
import { displayInstant, fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

function sizeText(size: string | null): string {
  return size ? `${Math.ceil(Number(size) / 1024)} KB` : "";
}

export function RestoreDialog({
  firstSetup,
  needsPassphrase,
  onClose,
}: {
  firstSetup: boolean;
  needsPassphrase: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const text = t.settings.backup;
  const [backups, setBackups] = useState<RemoteBackup[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [askPassphrase, setAskPassphrase] = useState(needsPassphrase);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [aside, setAside] = useState<string | null>(null);

  useEffect(() => {
    api
      .backupList()
      .then((list) => {
        setBackups(list);
        setSelected(list[0]?.id ?? null);
      })
      .catch((failure) => {
        setBackups([]);
        setError(errorMessage(t, failure));
      });
  }, [t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setRestoring(true);
    setError(null);
    try {
      setAside(await api.backupRestore(selected, askPassphrase ? passphrase : null));
    } catch (failure) {
      if (failure === "wrong_passphrase" || failure === "passphrase_required") {
        setAskPassphrase(true);
      }
      setError(errorMessage(t, failure));
    } finally {
      setRestoring(false);
    }
  }

  if (aside) {
    return (
      <Dialog open onOpenChange={() => window.location.reload()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{text.restoreDone}</DialogTitle>
            <DialogDescription className="break-all">
              {fill(text.restoreAside, { path: aside })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => window.location.reload()}>{text.continue}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={restoring ? undefined : onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{firstSetup ? text.firstSetupTitle : text.restoreTitle}</DialogTitle>
          <DialogDescription>
            {firstSetup ? text.firstSetupText : text.restoreWarning}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {backups && backups.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">{text.noBackups}</p>
          )}
          {backups && backups.length > 0 && (
            <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {backups.map((backup) => (
                <Button
                  key={backup.id}
                  type="button"
                  variant={backup.id === selected ? "default" : "outline"}
                  aria-pressed={backup.id === selected}
                  className="justify-between"
                  onClick={() => setSelected(backup.id)}
                >
                  <span>{displayInstant(backup.createdTime)}</span>
                  <span>{sizeText(backup.size)}</span>
                </Button>
              ))}
            </div>
          )}
          {askPassphrase && (
            <Field label={text.passphrase}>
              <Input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </Field>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={restoring} onClick={onClose}>
              {t.data.cancel}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!selected || restoring || (askPassphrase && !passphrase)}
            >
              {restoring ? text.restoring : text.restore}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
