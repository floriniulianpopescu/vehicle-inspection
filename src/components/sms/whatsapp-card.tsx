import { useCallback, useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { FormError } from "@/components/data/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage, type WhatsAppConnection } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const POLL_MS = 3000;

export function WhatsAppCard() {
  const { t } = useI18n();
  const text = t.sms.whatsapp;
  const [state, setState] = useState<WhatsAppConnection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .whatsappStatus()
      .then(setState)
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [t]);

  useEffect(refresh, [refresh]);

  // While the QR code waits to be scanned, check again until it is.
  const waiting = state === "qr" || state === "loading";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  async function run(action: () => Promise<void>, done?: string) {
    setError(null);
    try {
      await action();
      if (done) toast.success(done);
      setState("loading");
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{text.help}</p>
        <p className="flex gap-2 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {text.risk}
        </p>
        {state && (
          <div className="flex items-center gap-2 text-sm">
            {state === "ready" ? <Badge>{text.states.ready}</Badge> : <span>{text.states[state]}</span>}
          </div>
        )}
        <FormError message={error} />
        <div className="flex flex-wrap justify-end gap-2">
          {state === "ready" && (
            <Button variant="outline" onClick={() => run(api.whatsappLogOut, text.loggedOut)}>
              {text.logOut}
            </Button>
          )}
          <Button variant="outline" onClick={refresh}>
            {text.check}
          </Button>
          <Button onClick={() => run(api.whatsappOpen)}>{text.open}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
