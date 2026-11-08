import { useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { AppointmentDialog } from "@/components/data/appointment-dialog";
import { DeleteAppointmentDialog } from "@/components/data/delete-dialog";
import { RevisionDialog } from "@/components/data/revision-dialog";
import { EmptyRow, Pager, RowActions } from "@/components/data/table-parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagedList } from "@/hooks/use-paged-list";
import { api, errorMessage, type Appointment, type RevisionPrompt } from "@/lib/api";
import { displayDateTime, parseDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function AppointmentsTab({
  search,
  refreshKey,
  onChanged,
  onTotal,
}: {
  search: string;
  refreshKey: number;
  onChanged: () => void;
  onTotal: (total: number) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState("all");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [editing, setEditing] = useState<Appointment | "new" | null>(null);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [prompt, setPrompt] = useState<RevisionPrompt | null>(null);

  // A date that is still being typed simply doesn't filter yet.
  const from = parseDate(fromText);
  const to = parseDate(toText);

  const list = usePagedList(
    (page) =>
      api.listAppointments({
        search,
        isDone: status === "all" ? null : status === "done",
        from,
        to,
        page,
      }),
    `${search}|${status}|${from}|${to}`,
    refreshKey,
  );

  useEffect(() => onTotal(list.total), [list.total]);

  async function toggleDone(appointment: Appointment) {
    try {
      const result = await api.saveAppointment({
        appointmentId: appointment.appointmentId,
        clientId: appointment.clientId,
        carId: appointment.carId,
        timeDate: appointment.timeDate,
        isDone: !appointment.isDone,
        duration: appointment.duration,
      });
      setPrompt(result.revisionPrompt);
      onChanged();
    } catch (failure) {
      toast.error(errorMessage(t, failure));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label={t.data.done}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.data.filters.all}</SelectItem>
            <SelectItem value="open">{t.data.filters.open}</SelectItem>
            <SelectItem value="done">{t.data.filters.done}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-36"
          value={fromText}
          aria-label={t.data.filters.from}
          placeholder={`${t.data.filters.from} ${t.data.dateFormat}`}
          onChange={(event) => setFromText(event.target.value)}
        />
        <Input
          className="w-36"
          value={toText}
          aria-label={t.data.filters.to}
          placeholder={`${t.data.filters.to} ${t.data.dateFormat}`}
          onChange={(event) => setToText(event.target.value)}
        />
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <PlusIcon />
          {t.data.newAppointment}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.data.date}</TableHead>
            <TableHead>{t.data.duration}</TableHead>
            <TableHead>{t.data.client}</TableHead>
            <TableHead>{t.data.car}</TableHead>
            <TableHead>{t.data.done}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.rows.length === 0 && <EmptyRow columns={6} />}
          {list.rows.map((appointment) => (
            <TableRow key={appointment.appointmentId}>
              <TableCell>{displayDateTime(appointment.timeDate)}</TableCell>
              <TableCell>
                {appointment.duration} {t.data.minutes}
              </TableCell>
              <TableCell>{appointment.phone}</TableCell>
              <TableCell>{appointment.carLabel}</TableCell>
              <TableCell>
                <Checkbox
                  aria-label={t.data.done}
                  checked={appointment.isDone}
                  onCheckedChange={() => toggleDone(appointment)}
                />
              </TableCell>
              <TableCell>
                <RowActions
                  onEdit={() => setEditing(appointment)}
                  onDelete={() => setDeleting(appointment)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={list.page} total={list.total} onPage={list.setPage} />

      {editing && (
        <AppointmentDialog
          appointment={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            // A client or car may have been created before cancelling.
            onChanged();
          }}
          onSaved={(revisionPrompt) => {
            setEditing(null);
            setPrompt(revisionPrompt);
            onChanged();
          }}
        />
      )}
      {deleting && (
        <DeleteAppointmentDialog
          appointment={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onChanged();
          }}
        />
      )}
      {prompt && (
        <RevisionDialog
          prompt={prompt}
          onClose={() => setPrompt(null)}
          onSaved={() => {
            setPrompt(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
