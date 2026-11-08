import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { PAGE_SIZE } from "@/lib/api";
import { fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" title={t.data.edit} aria-label={t.data.edit} onClick={onEdit}>
        <PencilIcon />
      </Button>
      <Button variant="ghost" size="icon" title={t.data.delete} aria-label={t.data.delete} onClick={onDelete}>
        <Trash2Icon />
      </Button>
    </div>
  );
}

export function EmptyRow({ columns }: { columns: number }) {
  const { t } = useI18n();
  return (
    <TableRow>
      <TableCell colSpan={columns} className="py-8 text-center text-muted-foreground">
        {t.data.noRows}
      </TableCell>
    </TableRow>
  );
}

export function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-2 py-2 text-sm">
      <span className="text-muted-foreground">
        {fill(t.data.page, { page: page + 1, pages })}
      </span>
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
        {t.data.previous}
      </Button>
      <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        {t.data.next}
      </Button>
    </div>
  );
}
