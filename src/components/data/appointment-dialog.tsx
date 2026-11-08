import { useState, type FormEvent } from "react";
import { PlusIcon } from "lucide-react";
import { CarDialog } from "@/components/data/car-dialog";
import { ClientDialog } from "@/components/data/client-dialog";
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
import { api, errorMessage, type Appointment, type PickerOption, type RevisionPrompt } from "@/lib/api";
import { displayDate, parseDate, parseTime, todayIso } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const DEFAULT_DURATION = 30;

export function AppointmentDialog({
  appointment,
  onClose,
  onSaved,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onSaved: (prompt: RevisionPrompt | null) => void;
}) {
  const { t } = useI18n();
  const [client, setClient] = useState<PickerOption[]>(
    appointment ? [{ id: appointment.clientId, label: appointment.phone, linked: true }] : [],
  );
  const [car, setCar] = useState<PickerOption[]>(
    appointment ? [{ id: appointment.carId, label: appointment.carLabel, linked: true }] : [],
  );
  const [date, setDate] = useState(displayDate(appointment?.timeDate ?? todayIso()));
  const [time, setTime] = useState(appointment?.timeDate.slice(11, 16) ?? "");
  const [duration, setDuration] = useState(String(appointment?.duration ?? DEFAULT_DURATION));
  const [isDone, setIsDone] = useState(appointment?.isDone ?? false);
  const [creating, setCreating] = useState<"client" | "car" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (client.length === 0 || car.length === 0) {
      setError(t.data.errors.required_fields);
      return;
    }
    const isoDate = parseDate(date);
    const isoTime = parseTime(time);
    if (!isoDate || !isoTime) {
      setError(t.data.errors.invalid_date);
      return;
    }
    try {
      const result = await api.saveAppointment({
        appointmentId: appointment?.appointmentId ?? null,
        clientId: client[0].id,
        carId: car[0].id,
        timeDate: `${isoDate}T${isoTime}`,
        isDone,
        duration: Number(duration),
      });
      onSaved(result.revisionPrompt);
    } catch (failure) {
      setError(errorMessage(t, failure));
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{appointment ? t.data.editAppointment : t.data.newAppointment}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <EntityPicker
            kind="client"
            label={t.data.client}
            selected={client}
            onChange={setClient}
            linkedTo={car[0]?.id ?? null}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating("client")}>
            <PlusIcon />
            {t.data.newClient}
          </Button>
          <EntityPicker
            kind="car"
            label={t.data.car}
            selected={car}
            onChange={setCar}
            linkedTo={client[0]?.id ?? null}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating("car")}>
            <PlusIcon />
            {t.data.newCar}
          </Button>
          <div className="grid grid-cols-3 gap-4">
            <Field label={t.data.date}>
              <Input
                value={date}
                placeholder={t.data.dateFormat}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </Field>
            <Field label={t.data.time}>
              <Input
                value={time}
                placeholder={t.data.timeFormat}
                onChange={(event) => setTime(event.target.value)}
                required
              />
            </Field>
            <Field label={t.data.duration}>
              <Input
                type="number"
                min={1}
                max={1440}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                required
              />
            </Field>
          </div>
          <Label className="gap-2">
            <Checkbox checked={isDone} onCheckedChange={(checked) => setIsDone(checked === true)} />
            {t.data.done}
          </Label>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.data.cancel}
            </Button>
            <Button type="submit">{t.data.save}</Button>
          </DialogFooter>
        </form>

        {creating === "client" && (
          <ClientDialog
            client={null}
            onClose={() => setCreating(null)}
            onSaved={(saved) => {
              setClient([saved]);
              setCreating(null);
            }}
          />
        )}
        {creating === "car" && (
          <CarDialog
            car={null}
            onClose={() => setCreating(null)}
            onSaved={(saved) => {
              setCar([saved]);
              setCreating(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
