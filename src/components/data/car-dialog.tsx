import { useState, type FormEvent } from "react";
import { AutocompleteInput } from "@/components/autocomplete-input";
import { EntityPicker, isNewOption } from "@/components/data/entity-picker";
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
import { suggestManufacturers, suggestModels } from "@/lib/car-models";
import { displayDate, parseDate, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export const FREQUENCIES: Frequency[] = [6, 12, 24];

const UNKNOWN = "unknown";

/**
 * The last inspection date saved in this session. A new car starts with it, or with today
 * when the app has just started.
 */
let rememberedRevision: string | null = null;

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
  const [lastRevision, setLastRevision] = useState(() => {
    if (car) return car.lastRevision ? displayDate(car.lastRevision) : "";
    return displayDate(rememberedRevision ?? todayIso());
  });
  const [frequency, setFrequency] = useState<Frequency | null>(car?.revisionFrequency ?? null);
  const [clients, setClients] = useState(car?.clients ?? []);
  // A car already inspected by someone unrecorded keeps "unknown" until a new date is entered.
  const [inspectedBy, setInspectedBy] = useState(
    car?.inspectedBy != null ? String(car.inspectedBy) : car?.lastRevision ? UNKNOWN : "",
  );
  const [error, setError] = useState<string | null>(null);

  // Only a linked client can have brought the car. With one client there is nothing to choose.
  const chosenIsLinked = clients.some((client) => String(client.id) === inspectedBy);
  const broughtBy =
    inspectedBy === UNKNOWN || chosenIsLinked
      ? inspectedBy
      : clients.length === 0
        ? UNKNOWN
        : clients.length === 1
          ? String(clients[0].id)
          : "";

  function changeLastRevision(value: string) {
    setLastRevision(value);
    // A different date is a different visit, so ask again who came.
    if (parseDate(value) !== (car?.lastRevision ?? null)) setInspectedBy("");
  }

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
    if (revision && !broughtBy) {
      setError(t.data.chooseClient);
      return;
    }
    const bringer = clients.find((client) => String(client.id) === broughtBy);
    try {
      const saved = await api.saveCar({
        carId: car?.carId ?? null,
        plate,
        manufacturer,
        model,
        lastRevision: revision,
        revisionFrequency: frequency,
        clientIds: clients.filter((client) => !isNewOption(client)).map((client) => client.id),
        newPhones: clients.filter(isNewOption).map((client) => client.label),
        inspectedBy: revision && bringer && !isNewOption(bringer) ? bringer.id : null,
        inspectedByPhone: revision && bringer && isNewOption(bringer) ? bringer.label : null,
      });
      if (revision) rememberedRevision = revision;
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
            <Field label={t.data.model}>
              <AutocompleteInput
                value={model}
                placeholder={t.data.modelOptional}
                onChange={setModel}
                suggestions={suggestModels(model, manufacturer).map((item) => ({
                  key: `${item.manufacturer}|${item.model}`,
                  label: item.model,
                  hint: item.manufacturer,
                }))}
                onPick={(suggestion) => {
                  const [brand, name] = suggestion.key.split("|");
                  setModel(name);
                  setManufacturer(brand);
                }}
              />
            </Field>
            <Field label={t.data.manufacturer}>
              <AutocompleteInput
                value={manufacturer}
                onChange={setManufacturer}
                suggestions={suggestManufacturers(manufacturer).map((name) => ({ key: name, label: name }))}
                onPick={(suggestion) => setManufacturer(suggestion.key)}
                required
              />
            </Field>
          </div>
          <EntityPicker
            kind="client"
            label={t.data.linkedClients}
            selected={clients}
            onChange={setClients}
            multiple
            allowNewPhone
            linkedTo={car?.carId ?? null}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field label={t.data.lastRevision}>
              <Input
                value={lastRevision}
                placeholder={t.data.dateFormat}
                onChange={(event) => changeLastRevision(event.target.value)}
              />
            </Field>
            <div role="radiogroup" aria-label={t.data.frequency} className="flex flex-col gap-1.5">
              <span className="text-sm leading-none font-medium">{t.data.frequency}</span>
              <div className="grid grid-cols-3 gap-1">
                {FREQUENCIES.map((months) => (
                  <Button
                    key={months}
                    type="button"
                    role="radio"
                    aria-checked={frequency === months}
                    variant={frequency === months ? "default" : "outline"}
                    onClick={() => setFrequency(months)}
                  >
                    {t.data.monthsShort[months]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          {lastRevision.trim() && (
            <Field label={t.data.inspectedBy}>
              <Select value={broughtBy} onValueChange={setInspectedBy}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.data.chooseClient} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={String(client.id)}>
                      {client.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNKNOWN}>{t.data.unknownClient}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs font-normal text-muted-foreground">{t.data.inspectedByHint}</p>
            </Field>
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
