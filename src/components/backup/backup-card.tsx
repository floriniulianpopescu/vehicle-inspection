import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { PassphraseDialog } from "@/components/backup/passphrase-dialog";
import { RestoreDialog } from "@/components/backup/restore-dialog";
import { FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage, type BackupStatus } from "@/lib/api";
import { displayInstant, fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const RETENTION_CHOICES = [5, 10, 20, 30];

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm leading-none font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-sm">{children}</div>
    </div>
  );
}

export function BackupCard() {
  const { t } = useI18n();
  const text = t.settings.backup;
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [editingPassphrase, setEditingPassphrase] = useState(false);
  const [restore, setRestore] = useState<{ firstSetup: boolean } | null>(null);

  useEffect(() => {
    api
      .backupStatus()
      .then(setStatus)
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [t]);

  async function connect() {
    setSigningIn(true);
    setError(null);
    try {
      const next = await api.backupConnect();
      setStatus(next);
      if (next.localEmpty && (await api.backupList()).length > 0) {
        setRestore({ firstSetup: true });
      }
    } catch (failure) {
      if (failure !== "sign_in_cancelled") setError(errorMessage(t, failure));
    } finally {
      setSigningIn(false);
    }
  }

  async function disconnect() {
    setError(null);
    try {
      setStatus(await api.backupDisconnect());
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  async function backUp() {
    setBackingUp(true);
    setError(null);
    try {
      setStatus(await api.backupNow());
      toast.success(text.backupDone);
    } catch (failure) {
      setError(errorMessage(t, failure));
    } finally {
      setBackingUp(false);
    }
  }

  async function changeRetention(value: string) {
    if (!status) return;
    const retention = Number(value);
    try {
      await api.backupSetRetention(retention);
      setStatus({ ...status, retention });
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  const needsSignIn = status && (!status.connected || status.lastError === "drive_reauth");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status && !status.configured && (
          <p className="text-sm text-muted-foreground">{text.notConfigured}</p>
        )}

        {status?.configured && !status.connected && (
          <p className="text-sm text-muted-foreground">{text.intro}</p>
        )}

        {status?.connected && (
          <>
            <Row label={text.account}>
              <span className="truncate">{status.account ?? text.connected}</span>
              <Button size="sm" variant="outline" onClick={disconnect}>
                {text.disconnect}
              </Button>
            </Row>
            <Row label={text.passphrase}>
              <span className="text-muted-foreground">
                {status.hasPassphrase ? text.passphraseSet : text.passphraseNotSet}
              </span>
              <Button size="sm" variant="outline" onClick={() => setEditingPassphrase(true)}>
                {status.hasPassphrase ? text.change : text.set}
              </Button>
            </Row>
            <Row label={<Label htmlFor="backup-retention">{text.retention}</Label>}>
              <Select value={String(status.retention)} onValueChange={changeRetention}>
                <SelectTrigger id="backup-retention" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_CHOICES.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {fill(text.versions, { count })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label={text.lastBackup}>
              <span className="text-muted-foreground">
                {status.lastBackupAt ? displayInstant(status.lastBackupAt) : text.never}
              </span>
            </Row>
            {!status.hasPassphrase && (
              <p className="text-sm text-muted-foreground">{text.passphraseNeeded}</p>
            )}
            {status.lastError && !error && (
              <FormError
                message={fill(text.lastFailed, { reason: errorMessage(t, status.lastError) })}
              />
            )}
          </>
        )}

        <FormError message={error} />

        {status?.configured && (
          <div className="flex flex-wrap justify-end gap-2">
            {needsSignIn &&
              (signingIn ? (
                <>
                  <span className="mr-auto self-center text-sm text-muted-foreground">
                    {text.waitingForBrowser}
                  </span>
                  <Button variant="outline" onClick={() => void api.backupCancelConnect()}>
                    {t.data.cancel}
                  </Button>
                </>
              ) : (
                <Button onClick={connect}>{text.connect}</Button>
              ))}
            {status.connected && (
              <>
                <Button variant="outline" onClick={() => setRestore({ firstSetup: false })}>
                  {text.restore}
                </Button>
                <Button disabled={backingUp || !status.hasPassphrase} onClick={backUp}>
                  {backingUp ? text.backingUp : text.backupNow}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>

      {editingPassphrase && status && (
        <PassphraseDialog
          replacing={status.hasPassphrase}
          onClose={() => setEditingPassphrase(false)}
          onSaved={(next) => {
            setStatus(next);
            setEditingPassphrase(false);
          }}
        />
      )}
      {restore && status && (
        <RestoreDialog
          firstSetup={restore.firstSetup}
          needsPassphrase={!status.hasPassphrase}
          onClose={() => setRestore(null)}
        />
      )}
    </Card>
  );
}
