import type { ReactNode } from "react";
import { EmptyRow } from "@/components/data/table-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DueRow, Report } from "@/lib/api";
import { displayDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function InspectedTab({ report, controls }: { report: Report; controls: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {controls}
      <Hint>{t.reports.inspectedHint}</Hint>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.data.date}</TableHead>
            <TableHead>{t.data.plate}</TableHead>
            <TableHead>{t.data.manufacturer}</TableHead>
            <TableHead>{t.data.model}</TableHead>
            <TableHead>{t.reports.broughtBy}</TableHead>
            <TableHead>{t.data.nextRevision}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.inspected.length === 0 && <EmptyRow columns={6} />}
          {report.inspected.map((row) => (
            <TableRow key={row.inspectionId}>
              <TableCell>{displayDate(row.date)}</TableCell>
              <TableCell className="font-medium">{row.plate}</TableCell>
              <TableCell>{row.manufacturer}</TableCell>
              <TableCell>{row.model}</TableCell>
              <TableCell>{row.phone ?? <span className="text-muted-foreground">{t.data.unknownClient}</span>}</TableCell>
              <TableCell>{row.nextRevision ? displayDate(row.nextRevision) : "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Cars expiring soon or already expired, with the days left or overdue. */
export function DueTab({
  rows,
  expired,
  hint,
  controls,
}: {
  rows: DueRow[];
  expired: boolean;
  hint: string;
  controls?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {controls}
      <Hint>{hint}</Hint>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.data.plate}</TableHead>
            <TableHead>{t.data.manufacturer}</TableHead>
            <TableHead>{t.data.model}</TableHead>
            <TableHead>{t.data.lastRevision}</TableHead>
            <TableHead>{t.data.nextRevision}</TableHead>
            <TableHead>{expired ? t.reports.daysOverdue : t.reports.daysLeft}</TableHead>
            <TableHead>{t.reports.phones}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && <EmptyRow columns={7} />}
          {rows.map((car) => (
            <TableRow key={car.carId}>
              <TableCell className="font-medium">{car.plate}</TableCell>
              <TableCell>{car.manufacturer}</TableCell>
              <TableCell>{car.model}</TableCell>
              <TableCell>{displayDate(car.lastRevision)}</TableCell>
              <TableCell>{displayDate(car.nextRevision)}</TableCell>
              <TableCell>
                <Badge variant={expired ? "destructive" : "secondary"}>{car.days}</Badge>
              </TableCell>
              <TableCell>{car.phones || "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function RepeatTab({ report }: { report: Report }) {
  const { t } = useI18n();
  const text = t.reports;
  return (
    <div className="flex flex-col gap-4">
      <Hint>{text.repeatHint}</Hint>
      <Card>
        <CardHeader>
          <CardTitle>
            {text.repeatCars} ({report.repeatCars.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.data.plate}</TableHead>
                <TableHead>{t.data.manufacturer}</TableHead>
                <TableHead>{t.data.model}</TableHead>
                <TableHead>{text.visits}</TableHead>
                <TableHead>{text.firstVisit}</TableHead>
                <TableHead>{text.lastVisit}</TableHead>
                <TableHead>{text.phones}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.repeatCars.length === 0 && <EmptyRow columns={7} />}
              {report.repeatCars.map((car) => (
                <TableRow key={car.carId}>
                  <TableCell className="font-medium">{car.plate}</TableCell>
                  <TableCell>{car.manufacturer}</TableCell>
                  <TableCell>{car.model}</TableCell>
                  <TableCell>{car.visits}</TableCell>
                  <TableCell>{displayDate(car.firstVisit)}</TableCell>
                  <TableCell>{displayDate(car.lastVisit)}</TableCell>
                  <TableCell>{car.phones || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            {text.repeatClients} ({report.repeatClients.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.data.phone}</TableHead>
                <TableHead>{text.visits}</TableHead>
                <TableHead>{text.plates}</TableHead>
                <TableHead>{text.lastVisit}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.repeatClients.length === 0 && <EmptyRow columns={4} />}
              {report.repeatClients.map((client) => (
                <TableRow key={client.clientId}>
                  <TableCell className="font-medium">{client.phone}</TableCell>
                  <TableCell>{client.visits}</TableCell>
                  <TableCell className="whitespace-normal">{client.plates}</TableCell>
                  <TableCell>{displayDate(client.lastVisit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
