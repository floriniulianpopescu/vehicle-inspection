import { useState, type FormEvent } from "react";
import { EntityPicker } from "@/components/data/entity-picker";
import { Field, FormError } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { api, errorMessage, type Car, type Frequency, type PickerOption } from "@/lib/api";
import { displayDate, parseDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export const FREQUENCIES: Frequency[] = [6, 12, 24];

export function CarDialog({
  car,
  onClose,
  onSaved,
}: {
  car: Car | null;
  onClose: () => void;
  onSaved: (car: PickerOption) => void;
}) {
  const { t } = useI18n();
  const [plate, setPlate] = useState(car?.plate ?? "");
  const [manufacturer, setManufacturer] = useState(car?.manufacturer ?? "");
  const [model, setModel] = useState(car?.model ?? "");
  const [lastRevision, setLastRevision] = useState(
    car?.lastRevision ? displayDate(car.lastRevision) : "",
  );
  const [frequency, setFrequency] = useState(car ? String(car.revisionFrequency) : "");
  const [clients, setClients] = useState(car?.clients ?? []);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const revision = lastRevision.trim() ? parseDate(lastRevision) : null;
    if (lastRevision.trim() && !revision) {
      setError(t.data.errors.invalid_date);
      return;
    }
    if (!frequency) {
      setError(t.data.errors.required_fields);
      return;
    }
    try {
      const saved = await api.saveCar({
        carId: car?.carId ?? null,
        plate,
        manufacturer,
        model,
        lastRevision: revision,
        revisionFrequency: Number(frequency),
        clientIds: clients.map((client) => client.id),
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
          <DialogTitle>{car ? t.data.editCar : t.data.newCar}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t.data.plate}>
            <Input value={plate} onChange={(event) => setPlate(event.target.value)} required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t.data.manufacturer}>
              <Input
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                required
              />
            </Field>
            <Field label={t.data.model}>
              <Input value={model} onChange={(event) => setModel(event.target.value)} required />
            </Field>
            <Field label={t.data.lastRevision}>
              <Input
                value={lastRevision}
                placeholder={t.data.dateFormat}
                onChange={(event) => setLastRevision(event.target.value)}
              />
            </Field>
            <Field label={t.data.frequency}>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.data.chooseFrequency} />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((months) => (
                    <SelectItem key={months} value={String(months)}>
                      {t.data.months[months]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <EntityPicker
            kind="client"
            label={t.data.linkedClients}
            selected={clients}
            onChange={setClients}
            multiple
            linkedTo={car?.carId ?? null}
          />
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
