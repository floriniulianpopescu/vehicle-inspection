import { useEffect, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";
import { CarDialog, FREQUENCIES } from "@/components/data/car-dialog";
import { DeleteDialog } from "@/components/data/delete-dialog";
import { EmptyRow, Pager, RowActions } from "@/components/data/table-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { api, type Car, type CarSort, type RevisionState } from "@/lib/api";
import { displayDate, fill, parseDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const STATES: RevisionState[] = ["overdue", "soon", "ok", "unknown"];
const SORTS: CarSort[] = ["plate", "newest", "oldest"];

export const STATE_VARIANT = {
  overdue: "destructive",
  soon: "default",
  ok: "secondary",
  unknown: "outline",
} as const;

export function CarsTab({
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
  const [frequency, setFrequency] = useState("all");
  const [state, setState] = useState("all");
  const [sort, setSort] = useState<CarSort>("plate");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [editing, setEditing] = useState<Car | "new" | null>(null);
  const [deleting, setDeleting] = useState<Car | null>(null);

  // An empty date means no limit on that side. A half-typed date is ignored until it is valid.
  const from = parseDate(fromText);
  const to = parseDate(toText);
  const sortLabels: Record<CarSort, string> = {
    plate: t.data.filters.sortPlate,
    newest: t.data.filters.sortNewest,
    oldest: t.data.filters.sortOldest,
  };

  const list = usePagedList(
    (page) =>
      api.listCars({
        search,
        frequency: frequency === "all" ? null : Number(frequency),
        revisionState: state === "all" ? null : (state as RevisionState),
        revisionFrom: from,
        revisionTo: to,
        sort,
        page,
      }),
    `${search}|${frequency}|${state}|${sort}|${from}|${to}`,
    refreshKey,
  );

  useEffect(() => onTotal(list.total), [list.total]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={frequency} onValueChange={setFrequency}>
          <SelectTrigger className="w-44" aria-label={t.data.frequency}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.data.filters.allFrequencies}</SelectItem>
            {FREQUENCIES.map((months) => (
              <SelectItem key={months} value={String(months)}>
                {t.data.months[months]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="w-44" aria-label={t.data.nextRevision}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.data.filters.allStates}</SelectItem>
            {STATES.map((value) => (
              <SelectItem key={value} value={value}>
                {t.data.states[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as CarSort)}>
          <SelectTrigger className="w-64" aria-label={t.data.lastRevision}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {sortLabels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <PlusIcon />
          {t.data.newCar}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{t.data.lastRevision}</span>
        <Input
          className="w-32"
          value={fromText}
          aria-label={t.data.filters.lastRevisionFrom}
          aria-invalid={fromText.trim() !== "" && !from}
          placeholder={t.data.filters.from}
          onChange={(event) => setFromText(event.target.value)}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          className="w-32"
          value={toText}
          aria-label={t.data.filters.lastRevisionTo}
          aria-invalid={toText.trim() !== "" && !to}
          placeholder={t.data.filters.to}
          onChange={(event) => setToText(event.target.value)}
        />
        <DateRangePicker
          range={from && to ? { from, to } : null}
          onChange={(range) => {
            setFromText(displayDate(range.from));
            setToText(displayDate(range.to));
          }}
        />
        {(fromText || toText) && (
          <Button
            variant="ghost"
            size="icon"
            title={t.data.filters.clearDates}
            aria-label={t.data.filters.clearDates}
            onClick={() => {
              setFromText("");
              setToText("");
            }}
          >
            <XIcon />
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.data.plate}</TableHead>
            <TableHead>{t.data.manufacturer}</TableHead>
            <TableHead>{t.data.model}</TableHead>
            <TableHead>{t.data.lastRevision}</TableHead>
            <TableHead>{t.data.frequency}</TableHead>
            <TableHead>{t.data.nextRevision}</TableHead>
            <TableHead>{t.data.linkedClients}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.rows.length === 0 && <EmptyRow columns={8} />}
          {list.rows.map((car) => (
            <TableRow key={car.carId}>
              <TableCell className="font-medium">{car.plate}</TableCell>
              <TableCell>{car.manufacturer}</TableCell>
              <TableCell>{car.model}</TableCell>
              <TableCell>{car.lastRevision ? displayDate(car.lastRevision) : "—"}</TableCell>
              <TableCell>{t.data.months[car.revisionFrequency]}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {car.nextRevision && displayDate(car.nextRevision)}
                  <Badge variant={STATE_VARIANT[car.revisionState]}>
                    {t.data.states[car.revisionState]}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                {car.clients.map((client) => client.label).join(", ")}
              </TableCell>
              <TableCell>
                <RowActions onEdit={() => setEditing(car)} onDelete={() => setDeleting(car)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={list.page} total={list.total} onPage={list.setPage} />

      {editing && (
        <CarDialog
          car={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          title={fill(t.data.deleteCar, { name: deleting.plate })}
          loadPreview={() => api.previewDeleteCar(deleting.carId)}
          onConfirm={() => api.deleteCar(deleting.carId)}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
