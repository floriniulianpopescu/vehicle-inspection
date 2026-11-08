import { useState, type FormEvent } from "react";
import { EntityPicker } from "@/components/data/entity-picker";
import { Field, FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage, type Client, type PickerOption } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function ClientDialog({
  client,
  onClose,
  onSaved,
}: {
  client: Client | null;
  onClose: () => void;
  onSaved: (client: PickerOption) => void;
}) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [cars, setCars] = useState(client?.cars ?? []);
  const [smsOptOut, setSmsOptOut] = useState(client?.smsOptOut ?? false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await api.saveClient({
        clientId: client?.clientId ?? null,
        phone,
        smsOptOut,
        carIds: cars.map((car) => car.id),
      });
      onSaved(saved);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? t.data.editClient : t.data.newClient}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t.data.phone}>
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} required autoFocus />
          </Field>
          <EntityPicker
            kind="car"
            label={t.data.linkedCars}
            selected={cars}
            onChange={setCars}
            multiple
            linkedTo={client?.clientId ?? null}
          />
          <Label className="gap-2">
            <Checkbox
              checked={smsOptOut}
              onCheckedChange={(checked) => setSmsOptOut(checked === true)}
            />
            {t.data.smsOptOut}
          </Label>
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
