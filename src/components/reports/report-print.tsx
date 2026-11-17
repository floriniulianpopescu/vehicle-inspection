import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Report, ReportRequest } from "@/lib/api";
import { displayDate } from "@/lib/format";
import { formatPhones } from "@/lib/romanian";
import { useI18n } from "@/lib/i18n";

/** The width that fits across an A4 page in portrait, with 12 mm margins, at 96 dpi. */
const PORTRAIT_WIDTH_PX = 700;

/**
 * Prints the report, in portrait when its table fits the width of the page and in landscape
 * when it is wider.
 */
export function printReport() {
  const root = document.getElementById("report-print");
  if (!root) return;
  // Laid out off screen, unwrapped, to measure how wide each table wants to be.
  root.classList.add("measuring");
  for (const section of root.querySelectorAll<HTMLElement>("[data-print-section]")) {
    const table = section.querySelector("table.report-table");
    section.dataset.orientation =
      table && table.scrollWidth > PORTRAIT_WIDTH_PX ? "landscape" : "portrait";
  }
  root.classList.remove("measuring");
  window.print();
}

/**
 * `lead` goes above the title, on the same page: the report heading.
 *
 * The page has no top or bottom margin, so the printer adds no header or footer (page title,
 * address, date). The empty head and foot of this frame repeat on every page and give the
 * space back.
 */
function Section({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const spacer = (
    <tr>
      <td>
        <div className="page-spacer" />
      </td>
    </tr>
  );
  return (
    <section data-print-section>
      <table className="page-frame">
        <thead>{spacer}</thead>
        <tfoot>{spacer}</tfoot>
        <tbody>
          <tr>
            <td>
              {lead}
              <h2>{title}</h2>
              {children}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  const { t } = useI18n();
  return (
    <table className="report-table">
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

/** The printed report: only the inspected cars of the chosen period, numbered. */
export function ReportPrint({ report, request }: { report: Report; request: ReportRequest }) {
  const { t } = useI18n();
  const text = t.reports;
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
            text.rowNumber,
            t.data.date,
            t.data.plate,
            t.data.manufacturer,
            t.data.model,
            text.broughtBy,
            t.data.frequency,
          ]}
          rows={report.inspected.map((row, index) => [
            index + 1,
            displayDate(row.date),
            row.plate,
            row.manufacturer,
            row.model,
            row.phone ? formatPhones(row.phone) : t.data.unknownClient,
            t.data.months[row.revisionFrequency],
          ])}
        />
      </Section>
    </div>,
    document.body,
  );
}
