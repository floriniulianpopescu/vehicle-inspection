import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DueRow, Report, ReportRequest } from "@/lib/api";
import { displayDate, fill } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** The width that fits across an A4 page in portrait, with 12 mm margins, at 96 dpi. */
const PORTRAIT_WIDTH_PX = 700;

/**
 * Prints the report: each list gets its own pages, in portrait when its table fits the width
 * of the page and in landscape when it is wider.
 */
export function printReport() {
  const root = document.getElementById("report-print");
  if (!root) return;
  // Laid out off screen, unwrapped, to measure how wide each table wants to be.
  root.classList.add("measuring");
  for (const section of root.querySelectorAll<HTMLElement>("[data-print-section]")) {
    const table = section.querySelector("table");
    section.dataset.orientation =
      table && table.scrollWidth > PORTRAIT_WIDTH_PX ? "landscape" : "portrait";
  }
  root.classList.remove("measuring");
  window.print();
}

/** `lead` goes above the title, on the same page: the report heading for the first list. */
function Section({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section data-print-section>
      {lead}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  const { t } = useI18n();
  return (
    <table>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={headers.length}>{t.data.noRows}</td>
          </tr>
        )}
        {rows.map((cells, index) => (
          <tr key={index}>
            {cells.map((cell, column) => (
              <td key={column}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The printed version of the report, the same lists as the .xlsx export. */
export function ReportPrint({ report, request }: { report: Report; request: ReportRequest }) {
  const { t } = useI18n();
  const text = t.reports;
  const due = (rows: DueRow[], daysTitle: string) => (
    <Table
      headers={[
        t.data.plate,
        t.data.manufacturer,
        t.data.model,
        t.data.lastRevision,
        t.data.nextRevision,
        daysTitle,
        text.phones,
      ]}
      rows={rows.map((car) => [
        car.plate,
        car.manufacturer,
        car.model,
        displayDate(car.lastRevision),
        displayDate(car.nextRevision),
        car.days,
        car.phones || "-",
      ])}
    />
  );
  const generated = `${displayDate(report.generatedAt)} ${report.generatedAt.slice(11, 16)}`;

  return createPortal(
    <div id="report-print" className="report-print" aria-hidden>
      <Section
        lead={
          <header>
            <h1>{text.printTitle}</h1>
            <p>
              {t.data.frequency}:{" "}
              {request.frequency ? t.data.months[request.frequency] : t.data.filters.allFrequencies}
              {" · "}
              {text.generatedAt}: {generated}
            </p>
          </header>
        }
        title={`${text.tabs.inspected} (${displayDate(request.from)} – ${displayDate(request.to)})`}
      >
        <Table
          headers={[
            t.data.date,
            t.data.plate,
            t.data.manufacturer,
            t.data.model,
            text.broughtBy,
            t.data.nextRevision,
          ]}
          rows={report.inspected.map((row) => [
            displayDate(row.date),
            row.plate,
            row.manufacturer,
            row.model,
            row.phone ?? t.data.unknownClient,
            row.nextRevision ? displayDate(row.nextRevision) : "-",
          ])}
        />
      </Section>
      <Section title={`${text.tabs.expiring} (${fill(text.withinDays, { days: request.expiringDays })})`}>
        {due(report.expiring, text.daysLeft)}
      </Section>
      <Section title={text.tabs.expired}>{due(report.expired, text.daysOverdue)}</Section>
      <Section title={`${text.tabs.repeat}: ${text.repeatCars}`}>
        <Table
          headers={[
            t.data.plate,
            t.data.manufacturer,
            t.data.model,
            text.visits,
            text.firstVisit,
            text.lastVisit,
            text.phones,
          ]}
          rows={report.repeatCars.map((car) => [
            car.plate,
            car.manufacturer,
            car.model,
            car.visits,
            displayDate(car.firstVisit),
            displayDate(car.lastVisit),
            car.phones || "-",
          ])}
        />
      </Section>
      <Section title={`${text.tabs.repeat}: ${text.repeatClients}`}>
        <Table
          headers={[t.data.phone, text.visits, text.plates, text.lastVisit]}
          rows={report.repeatClients.map((client) => [
            client.phone,
            client.visits,
            client.plates,
            displayDate(client.lastVisit),
          ])}
        />
      </Section>
    </div>,
    document.body,
  );
}
