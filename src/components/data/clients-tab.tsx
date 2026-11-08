import { useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import { ClientDialog } from "@/components/data/client-dialog";
import { DeleteDialog } from "@/components/data/delete-dialog";
import { EmptyRow, Pager, RowActions } from "@/components/data/table-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagedList } from "@/hooks/use-paged-list";
import { api, type Client } from "@/lib/api";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function ClientsTab({
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
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const list = usePagedList((page) => api.listClients({ search, page }), search, refreshKey);

  useEffect(() => onTotal(list.total), [list.total]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          {t.data.newClient}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.data.phone}</TableHead>
            <TableHead>{t.data.linkedCars}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.rows.length === 0 && <EmptyRow columns={3} />}
          {list.rows.map((client) => (
            <TableRow key={client.clientId}>
              <TableCell>{client.phone}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {client.cars.map((car) => (
                    <Badge key={car.id} variant="secondary">
                      {car.label}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <RowActions onEdit={() => setEditing(client)} onDelete={() => setDeleting(client)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={list.page} total={list.total} onPage={list.setPage} />

      {editing && (
        <ClientDialog
          client={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          title={fill(t.data.deleteClient, { name: deleting.phone })}
          loadPreview={() => api.previewDeleteClient(deleting.clientId)}
          onConfirm={() => api.deleteClient(deleting.clientId)}
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
