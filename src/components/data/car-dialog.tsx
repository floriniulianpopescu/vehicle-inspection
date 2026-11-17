import { useEffect, useState, type FormEvent } from "react";
import { AutocompleteInput } from "@/components/autocomplete-input";
import { EntityPicker, isNewOption } from "@/components/data/entity-picker";
import { Field, FormError, FormWarning } from "@/components/data/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage, type Car, type Frequency, type PickerOption } from "@/lib/api";
import { suggestManufacturers, suggestModels } from "@/lib/car-models";
import { compactPlate, formatPhone, isRomanianPlate } from "@/lib/romanian";
import { displayDate, fill, parseDate, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export const FREQUENCIES: Frequency[] = [6, 12, 24, 36];

const UNKNOWN = "unknown";
/** Typed in Last inspection when there is no valid one, e.g. the car failed its ITP. */
const NO_DATE = "-";

/** Empty or "-" means no last inspection: the car is saved with an unknown state. */
function hasNoDate(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || trimmed === NO_DATE;
}

/**
 * The last inspection date saved in this session. A new car starts with it, or with today
 * when the app has just started.
 */
let rememberedRevision: string | null = null;

/** Existing cars whose plate starts with what is typed, for filling in the new car form. */
function useMatchingCars(plate: string, enabled: boolean): Car[] {
  const [cars, setCars] = useState<Car[]>([]);
  const prefix = compactPlate(plate);
  useEffect(() => {
    if (!enabled || prefix.length < 2) {
      setCars([]);
      return;
    }
    let stale = false;
    api
      .listCars({
        search: "",
        frequency: null,
        revisionState: null,
        revisionFrom: null,
        revisionTo: null,
        sort: "plate",
        platePrefix: prefix,
        page: 0,
      })
      .then((page) => {
        if (!stale) setCars(page.rows.slice(0, 8));
      })
      .catch(() => {
        if (!stale) setCars([]);
      });
    return () => {
      stale = true;
    };
  }, [prefix, enabled]);
  return cars;
}

/**
 * The car's most recent number: whoever brought it to its last inspection, otherwise the
 * newest client linked to it.
 */
export function latestClient(car: Car): PickerOption | null {
  const brought = car.clients.find((client) => client.id === car.inspectedBy);
  if (brought) return brought;
  return car.clients.reduce<PickerOption | null>(
    (newest, client) => (newest === null || client.id > newest.id ? client : newest),
    null,
  );
}

export function CarDialog({
  car,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  car: Car | null;
  onClose: () => void;
  onSaved: (car: PickerOption) => void;
  /** A car picked from the plate suggestions of the new car form, to edit instead. */
  onOpenExisting?: (car: Car) => void;
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
  // Only the most recent number is shown; the car's other numbers stay linked when saving and
  // are listed in its details window.
  const latest = car ? latestClient(car) : null;
  const [clients, setClients] = useState<PickerOption[]>(latest ? [latest] : []);
  const kept = (car?.clients ?? []).filter((client) => client.id !== latest?.id);
  const [notes, setNotes] = useState(car?.notes ?? "");
  const [feedback, setFeedback] = useState(car?.feedback ?? false);
  // The plate warning waits until the field is left, so it does not flash while typing.
  const [typingPlate, setTypingPlate] = useState(false);
  const matching = useMatchingCars(plate, !car && Boolean(onOpenExisting));
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
    const revision = hasNoDate(lastRevision) ? null : parseDate(lastRevision);
    if (!hasNoDate(lastRevision) && !revision) {
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
        notes,
        feedback,
        clientIds: [
          ...clients.filter((client) => !isNewOption(client)).map((client) => client.id),
          ...kept.filter((client) => !clients.some((chosen) => chosen.id === client.id)).map((client) => client.id),
        ],
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
            {car || !onOpenExisting ? (
              <Input
                value={plate}
                onChange={(event) => setPlate(event.target.value)}
                onFocus={() => setTypingPlate(true)}
                onBlur={() => setTypingPlate(false)}
                required
                autoFocus
              />
            ) : (
              <AutocompleteInput
                value={plate}
                onChange={setPlate}
                required
                autoFocus
                pickOnTab={false}
                onFocus={() => setTypingPlate(true)}
                onBlurCapture={() => setTypingPlate(false)}
                suggestions={matching.map((match) => ({
                  key: String(match.carId),
                  label: match.plate,
                  hint: [match.manufacturer, match.model === "-" ? "" : match.model].join(" ").trim(),
                }))}
                onPick={(suggestion) => {
                  const match = matching.find((item) => String(item.carId) === suggestion.key);
                  if (match) onOpenExisting(match);
                }}
              />
            )}
            {!car && matching.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">{t.data.plateSuggestHint}</span>
            )}
            <FormWarning
              message={!typingPlate && plate.trim() !== "" && !isRomanianPlate(plate) && t.data.plateWarning}
            />
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
            compact
            linkedTo={car?.carId ?? null}
          />
          {kept.length > 0 && (
            <p className="-mt-2 text-xs text-muted-foreground">
              {fill(t.data.otherNumbersKept, { count: kept.length })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label={t.data.lastRevision}>
              <Input
                value={lastRevision}
                placeholder={`${t.data.dateFormat} / ${NO_DATE}`}
                onChange={(event) => changeLastRevision(event.target.value)}
              />
              {/* Always shown, so the form never shifts while typing. */}
              <span className="text-xs font-normal text-muted-foreground">{t.data.noDateHint}</span>
            </Field>
            <div role="radiogroup" aria-label={t.data.frequency} className="flex flex-col gap-1.5">
              <span className="text-sm leading-none font-medium">{t.data.frequency}</span>
              <div className="grid grid-cols-4 gap-1">
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
          {!hasNoDate(lastRevision) && (
            <Field label={t.data.inspectedBy}>
              <Select value={broughtBy} onValueChange={setInspectedBy}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.data.chooseClient} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={String(client.id)}>
                      {formatPhone(client.label)}
                    </SelectItem>
                  ))}
                  <SelectItem value={UNKNOWN}>{t.data.unknownClient}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs font-normal text-muted-foreground">{t.data.inspectedByHint}</p>
            </Field>
          )}
          <Field label={t.data.notes}>
            <Textarea
              value={notes}
              rows={2}
              placeholder={t.data.modelOptional}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={feedback}
              onCheckedChange={(checked) => setFeedback(checked === true)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t.data.feedback}</span>
              <span className="text-xs text-muted-foreground">{t.data.feedbackHint}</span>
            </span>
          </label>
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
