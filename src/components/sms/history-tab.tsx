import { useEffect, useState } from "react";
import { FormError } from "@/components/data/field";
import { EmptyRow, Pager } from "@/components/data/table-parts";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, errorMessage, type Page, type SentMessage } from "@/lib/api";
import { displayDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function HistoryTab() {
  const { t } = useI18n();
  const text = t.sms;
  const [page, setPage] = useState(0);
  const [list, setList] = useState<Page<SentMessage>>({ rows: [], total: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .smsHistory(page)
      .then(setList)
      .catch((failure) => setError(errorMessage(t, failure)));
  }, [page, t]);

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{text.sentAt}</TableHead>
            <TableHead>{text.type}</TableHead>
            <TableHead>{text.channel}</TableHead>
            <TableHead>{t.data.phone}</TableHead>
            <TableHead>{t.data.plate}</TableHead>
            <TableHead>{text.status}</TableHead>
            <TableHead>{text.message}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.rows.length === 0 && <EmptyRow columns={7} />}
          {list.rows.map((message) => (
            <TableRow key={message.messageId}>
              <TableCell>{displayDateTime(message.sentAt)}</TableCell>
              <TableCell>
                <Badge variant="secondary">{text.kinds[message.kind]}</Badge>
              </TableCell>
              <TableCell>
                {/* ITP reminders go by SMS, greetings by WhatsApp. */}
                {message.kind === "inspection" ? text.channels.sms : text.channels.whatsapp}
              </TableCell>
              <TableCell>{message.phone}</TableCell>
              <TableCell className="font-medium">{message.plate ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={message.status === "sent" ? "outline" : "destructive"}>
                  {text.statuses[message.status]}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-normal">{message.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={page} total={list.total} onPage={setPage} />
    </div>
  );
}
