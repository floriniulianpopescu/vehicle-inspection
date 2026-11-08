import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Field, FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function GatewayCard() {
  const { t } = useI18n();
  const text = t.sms.gateway;
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .smsGatewaySettings()
      .then((settings) => {
        setAddress(settings.address);
        setUsername(settings.username);
        setHasPassword(settings.hasPassword);
      })
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [t]);

  async function save() {
    const saved = await api.smsSaveGatewaySettings(address, username, password || null);
    setHasPassword(saved.hasPassword);
    setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await save();
      toast.success(text.saved);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  async function test() {
    setError(null);
    setTesting(true);
    try {
      await save();
      await api.smsTestGateway();
      toast.success(text.connected);
    } catch (failure) {
      setError(errorMessage(t, failure));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{text.help}</p>
          <Field label={text.address}>
            <Input
              value={address}
              placeholder="192.168.1.50"
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
          <Field label={text.username}>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label={text.password}>
            <Input
              type="password"
              autoComplete="off"
              value={password}
              placeholder={hasPassword ? text.passwordSaved : ""}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={testing} onClick={test}>
              {testing ? text.testing : text.test}
            </Button>
            <Button type="submit">{t.data.save}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
