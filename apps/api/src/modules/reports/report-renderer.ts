import { BadRequestException } from "@nestjs/common";
import { REPORT_COLUMNS, REPORT_DEFAULT_COLUMNS, ReportColumn, ReportKind, resolveReportSections } from "@avidity/shared/dist";
import { Workbook } from "exceljs";
import PDFDocument from "pdfkit";
import path from "path";
import { ReportPresentationDto } from "./dto/ticket-report-query.dto";
import { localDay } from "./report-time";

export type ReportDocument = {
  kind: ReportKind; title: string; company: string; application: string; color: string; logo?: Buffer;
  generatedAt: Date; timeZone: string; locale: string; currency?: string;
  criteria: Array<[string, string]>; metrics: Array<[string, number | null, string]>;
  distributions: Array<{ key: string; title: string; items: Array<{ label: string; count: number }> }>;
  activity: Array<Record<string, string | number>>;
  rows: Array<Record<string, unknown>>; matched: number; query: ReportPresentationDto;
};
function brandText(color: string) {
  const rgb = color.slice(1).match(/../g)!.map((part) => parseInt(part, 16));
  return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 160 ? "#172033" : "#FFFFFF";
}
export function selectedColumns(kind: ReportKind, query: ReportPresentationDto) {
  const keys = query.columns?.split(",") ?? REPORT_DEFAULT_COLUMNS[kind];
  if (!keys.length || new Set(keys).size !== keys.length) throw new BadRequestException("Choose at least one column without duplicates.");
  return keys.map((key) => {
    const col = REPORT_COLUMNS[kind].find((c) => c.key === key);
    if (!col) throw new BadRequestException(`Unsupported report column: ${key}`);
    return col;
  });
}
export function reportSections(query: ReportPresentationDto, kind: ReportKind = "ticket-report") {
  try { return resolveReportSections(kind, query.sections); }
  catch { throw new BadRequestException("Choose valid report sections."); }
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) && typeof value !== "number") text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function dateText(value: unknown, type: ReportColumn["type"], model: ReportDocument) {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  if (type === "dateOnly") return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat(model.locale, { timeZone: model.timeZone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
function textValue(row: Record<string, unknown>, col: ReportColumn, model: ReportDocument) {
  const value = row[col.key];
  if (value === null || value === undefined) return "Not recorded";
  if (col.type === "date" || col.type === "dateOnly") return dateText(value, col.type, model);
  if (col.type === "currency") return model.currency ? new Intl.NumberFormat(model.locale, { style: "currency", currency: model.currency }).format(Number(value)) : String(value);
  return String(value);
}
function excelDate(value: unknown, col: ReportColumn, model: ReportDocument) {
  if (!value) return null;
  const date = new Date(String(value));
  if (col.type === "dateOnly") return new Date(`${date.toISOString().slice(0, 10)}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: model.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
  // Excel has no timezone type. Store local wall time and label the zone in Criteria.
  return new Date(`${localDay(date, model.timeZone)}T${parts}Z`);
}
export async function renderReport(model: ReportDocument, format: "csv" | "xlsx" | "pdf") {
  const cols = selectedColumns(model.kind, model.query);
  const sections = reportSections(model.query, model.kind);
  model = { ...model, metrics: model.metrics.filter(([, , key]) => sections.includes(`metric:${key}`)), distributions: model.distributions.filter((group) => sections.includes(group.key)) };
  if (format === "csv") {
    // CSV remains a rectangular detail dataset for existing import workflows.
    const rows = [cols.map((c) => c.label), ...model.rows.map((row) => cols.map((col) => col.type === "number" || col.type === "currency" ? row[col.key] : textValue(row, col, model)))];
    return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  }
  if (format === "xlsx") return renderWorkbook(model, cols, sections);
  return renderPdf(model, cols, sections);
}
async function renderWorkbook(model: ReportDocument, cols: ReportColumn[], sections: string[]) {
  const book = new Workbook();
  book.creator = model.company || model.application;
  book.title = model.title; book.created = model.generatedAt;
  if (sections.includes("criteria")) {
    const criteria = book.addWorksheet("Criteria");
    criteria.columns = [{ width: 28 }, { width: 90 }];
    criteria.addRows([["Report", model.title], ["Organization", model.company], ["Generated", model.generatedAt.toISOString()], ["Timezone", model.timeZone], ...model.criteria.filter(([key]) => key !== "Timezone"), ["Matched records", model.matched], ["Detail records exported", sections.includes("detail") ? model.rows.length : 0], ["Definitions", "Counts describe the current state of matching records. Activity contains only events within the selected period; this is not a historical state snapshot."]]);
  }
  if (model.metrics.length) {
    const sheet = book.addWorksheet("Summary"); sheet.columns = [{ width: 38 }, { width: 24 }];
    sheet.addRows([["Metric", "Value"], ...model.metrics.map(([name, value]) => [name, value])]);
    sheet.getColumn(2).numFmt = "#,##0";
    model.metrics.forEach(([name], index) => { if (name.includes("Estimate") && model.currency) sheet.getCell(index + 2, 2).numFmt = `"${model.currency}" #,##0.00`; });
  }
  if (sections.includes("activity")) {
    const activity = book.addWorksheet("Activity");
    const keys = Object.keys(model.activity[0] ?? { period: "", created: 0 }).filter((key) => key !== "label");
    activity.columns = keys.map((key) => ({ header: key.replace(/^./, (c) => c.toUpperCase()), key, width: 22 }));
    activity.addRows(model.activity);
  }
  if (model.distributions.length) {
    const distribution = book.addWorksheet("Distributions");
    distribution.columns = [{ width: 30 }, { width: 48 }, { width: 18 }];
    distribution.addRow(["Breakdown", "Category", "Count"]);
    for (const group of model.distributions) for (const item of group.items) distribution.addRow([group.title, item.label, item.count]);
  }
  if (sections.includes("detail")) {
    const sheet = book.addWorksheet("Detail");
    sheet.columns = cols.map((col) => ({ header: col.label, key: col.key, width: col.width ?? (col.type === "date" ? 24 : 18) }));
    for (const source of model.rows) {
      const row = sheet.addRow(cols.map((col) => col.type === "date" || col.type === "dateOnly" ? excelDate(source[col.key], col, model) : source[col.key] ?? null));
      row.height = Math.max(30, ...cols.map((col) => Math.ceil(String(source[col.key] ?? "").length / Math.max(12, (col.width ?? 18) - 2)) * 15 + 10));
      row.height = Math.min(409, row.height);
    }
    cols.forEach((col, i) => { sheet.getColumn(i + 1).numFmt = col.type === "date" ? "yyyy-mm-dd hh:mm" : col.type === "dateOnly" ? "yyyy-mm-dd" : col.type === "currency" && model.currency ? `"${model.currency}" #,##0.00` : col.type === "number" ? "#,##0" : "General"; });
  }
  if (!book.worksheets.length) throw new BadRequestException("The selected sections have no available content. Select detail or another section.");
  const color = model.color.replace("#", "").toUpperCase();
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    sheet.pageSetup = { orientation: model.query.orientation ?? "landscape", paperSize: model.query.paper === "A4" ? 9 : undefined, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
    if (sheet.name === "Detail" && cols.reduce((sum, col) => sum + (col.width ?? 18), 0) > 150) sheet.pageSetup = { ...sheet.pageSetup, fitToPage: false, scale: 100, printTitlesColumn: "A:A" };
    sheet.headerFooter.oddHeader = `&L${model.title.slice(0, 80).replace(/&/g, "&&")}&R${model.timeZone}`;
    sheet.headerFooter.oddFooter = "Page &P of &N";
    sheet.eachRow((row, n) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: "Calibri", size: 11, ...(n === 1 ? { bold: true, color: { argb: `FF${brandText(model.color).slice(1)}` } } : {}) };
        cell.alignment = { vertical: "top", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: n === 1 ? `FF${color}` : n % 2 === 0 ? "FFF1F5F9" : "FFFFFFFF" } };
      });
      if (n === 1) row.height = 32;
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function renderPdf(model: ReportDocument, cols: ReportColumn[], sections: string[]) {
  const doc = new PDFDocument({ margin: 40, size: model.query.paper ?? "LETTER", layout: model.query.orientation ?? "landscape", bufferPages: true, info: { Title: model.title, Author: model.company || model.application } });
  doc.registerFont("Report", path.join(__dirname, "assets/LiberationSans-Regular.ttf"));
  doc.registerFont("ReportBold", path.join(__dirname, "assets/LiberationSans-Bold.ttf"));
  const chunks: Buffer[] = []; doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  const left = 40, width = doc.page.width - 80, bottom = doc.page.height - 48;
  let y = 40;
  const newPage = () => { doc.addPage(); y = 40; doc.font("ReportBold").fontSize(9).fillColor(model.color).text(model.title, left, y, { width }); y += 24; };
  const space = (height: number) => { if (y + height > bottom) newPage(); };
  const paragraph = (text: string, size = 10, bold = false) => {
    doc.font(bold ? "ReportBold" : "Report").fontSize(size);
    const h = doc.heightOfString(text, { width }); space(h + 9);
    doc.fillColor("#172033").text(text, left, y, { width }); y += h + 9;
  };
  if (model.logo) { try { doc.image(model.logo, left, y, { fit: [130, 40] }); y += 49; } catch { /* The textual company name remains the branding fallback. */ } }
  paragraph(model.company || model.application, 10, true);
  paragraph(model.title, 23, true);
  paragraph(`Generated ${dateText(model.generatedAt.toISOString(), "date", model)} (${model.timeZone})`, 9);
  if (sections.includes("criteria")) for (const [key, value] of model.criteria) paragraph(`${key}: ${value}`, 9);
  else for (const [key, value] of model.criteria.filter(([key]) => ["Period", "Scope", "Excluded records"].includes(key))) paragraph(`${key}: ${value}`, 9);
  paragraph(`${model.matched.toLocaleString()} matching records · ${sections.includes("detail") ? model.rows.length.toLocaleString() : 0} detail records included`, 10, true);
  if (sections.includes("criteria")) paragraph("Counts show the current state of matching records. Activity includes only events in the selected period. This report does not reconstruct historical state.", 9);
  if (model.metrics.length) {
    paragraph("Summary", 15, true);
    const cardWidth = (width - 24) / 3;
    for (let i = 0; i < model.metrics.length; i += 3) {
      space(66); const rowY = y;
      model.metrics.slice(i, i + 3).forEach(([name, value], j) => {
        const x = left + j * (cardWidth + 12);
        doc.roundedRect(x, rowY, cardWidth, 56, 5).fill("#F1F5F9");
        doc.fillColor("#475569").font("Report").fontSize(9).text(name, x + 10, rowY + 8, { width: cardWidth - 20 });
        const display = value === null ? "Not configured" : name.includes("Estimate") && model.currency ? new Intl.NumberFormat(model.locale, { style: "currency", currency: model.currency }).format(value) : value.toLocaleString(model.locale);
        doc.fillColor("#172033").font("ReportBold").fontSize(17).text(display, x + 10, rowY + 28, { width: cardWidth - 20 });
      }); y = rowY + 68;
    }
  }
  const wrap = (text: string, cellWidth: number) => {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (doc.widthOfString(next) <= cellWidth) { line = next; continue; }
        if (line) lines.push(line);
        line = "";
        for (const character of word) {
          if (line && doc.widthOfString(line + character) > cellWidth) { lines.push(line); line = ""; }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const table = (title: string, headers: string[], rows: string[][], weights: number[]) => {
    space(125); paragraph(title, 13, true);
    const total = weights.reduce((a, b) => a + b, 0); const widths = weights.map((w) => w / total * width);
    const heading = () => {
      doc.font("ReportBold").fontSize(9);
      const h = Math.max(...headers.map((s, i) => doc.heightOfString(s, { width: widths[i] - 12 }))) + 16;
      doc.rect(left, y, width, h).fill(model.color); let x = left;
      headers.forEach((s, i) => { doc.fillColor(brandText(model.color)).text(s, x + 6, y + 8, { width: widths[i] - 12 }); x += widths[i]; }); y += h;
    };
    heading();
    if (!rows.length) { paragraph("No matching records."); return; }
    rows.forEach((row, n) => {
      doc.font("Report").fontSize(9);
      const lines = row.map((cell, i) => wrap(cell, widths[i] - 12));
      let offset = 0; const count = Math.max(...lines.map((l) => l.length));
      while (offset < count) {
        let capacity = Math.floor((bottom - y - 12) / 12);
        if (capacity < 2) { newPage(); heading(); doc.font("Report").fontSize(9); capacity = Math.floor((bottom - y - 12) / 12); }
        // Keep ordinary rows together. Only unusually tall records continue across pages.
        if (offset === 0 && count > capacity && count * 12 + 12 < bottom - 110) { newPage(); heading(); doc.font("Report").fontSize(9); capacity = Math.floor((bottom - y - 12) / 12); }
        const shown = Math.min(capacity, count - offset); const h = shown * 12 + 12;
        doc.rect(left, y, width, h).fill(n % 2 ? "#FFFFFF" : "#F1F5F9");
        let x = left;
        lines.forEach((cell, i) => { cell.slice(offset, offset + shown).forEach((line, j) => doc.fillColor("#172033").text(line, x + 6, y + 6 + j * 12, { width: widths[i] - 12, lineBreak: false })); x += widths[i]; });
        y += h; offset += shown;
      }
    }); y += 18;
  };
  {
    if (sections.includes("activity") && model.activity.length) {
      space(250); paragraph("Activity within the period", 13, true);
      const keys = Object.keys(model.activity[0]).filter((k) => k !== "label" && k !== "period");
      const max = Math.max(1, ...model.activity.flatMap((r) => keys.map((k) => Number(r[k]))));
      const colors = [model.color, "#64748B", "#15803D"];
      const barGroup = width / model.activity.length, height = 145, top = y;
      model.activity.forEach((row, index) => {
        keys.forEach((key, series) => {
          const value = Number(row[key]); const h = value / max * height;
          if (value > 0) doc.rect(left + index * barGroup + series * barGroup / (keys.length + 1), top + height - h, Math.max(.25, barGroup / (keys.length + 1) - 1), h).fill(colors[series % colors.length]);
        });
        if (index % Math.max(1, Math.ceil(model.activity.length / 8)) === 0) doc.font("Report").fontSize(8).fillColor("#475569").text(String(row.period), left + index * barGroup, top + height + 8, { width: 75, lineBreak: false });
      });
      y = top + height + 32;
      paragraph(keys.map((key) => `${key}: ${model.activity.reduce((sum, row) => sum + Number(row[key]), 0)}`).join("     "), 9);
      keys.forEach((key, i) => { doc.rect(left + i * 160, y, 8, 8).fill(colors[i % colors.length]); doc.font("Report").fontSize(9).fillColor("#172033").text(key, left + i * 160 + 13, y - 1, { width: 140 }); });
      y += 25;
    }
    for (const distribution of model.distributions) {
      space(65); paragraph(distribution.title, 13, true);
      const max = Math.max(1, ...distribution.items.map((i) => i.count));
      for (const item of distribution.items) {
        doc.font("Report").fontSize(9);
        const h = Math.max(25, doc.heightOfString(item.label, { width: width * .46 }) + 8); space(h);
        doc.fillColor("#172033").text(item.label, left, y, { width: width * .46 });
        if (item.count > 0) doc.rect(left + width * .49, y + 3, item.count / max * width * .42, 9).fill(model.color);
        doc.fillColor("#172033").text(String(item.count), left + width * .93, y, { width: width * .07, align: "right" }); y += h;
      } y += 12;
    }
  }
  if (sections.includes("detail")) {
    // Split wide tables into sections, repeating the identifier instead of shrinking text.
    const maxColumns = model.query.orientation === "portrait" ? 4 : 8;
    const groups: ReportColumn[][] = [];
    for (let i = 0; i < cols.length; i += i === 0 ? maxColumns : maxColumns - 1) groups.push(i === 0 ? cols.slice(0, maxColumns) : [cols[0], ...cols.slice(i, i + maxColumns - 1)]);
    groups.forEach((group, i) => {
      if (i > 0 || model.metrics.length || model.distributions.length || (sections.includes("activity") && model.activity.length)) newPage();
      table(`Detail${groups.length > 1 ? ` · section ${i + 1} of ${groups.length}` : ""}`, group.map((c) => c.label), model.rows.map((r) => group.map((c) => textValue(r, c, model))), group.map((c) => c.width ?? 20));
    });
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i); const bottomMargin = doc.page.margins.bottom; doc.page.margins.bottom = 0; doc.font("Report").fontSize(8).fillColor("#64748B").text(`${model.application} · Page ${i + 1} of ${pages.count}`, left, doc.page.height - 29, { width, lineBreak: false, align: "right" }); doc.page.margins.bottom = bottomMargin;
  }
  doc.end(); return done;
}
