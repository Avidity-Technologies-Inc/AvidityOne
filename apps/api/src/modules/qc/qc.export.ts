import { Workbook } from "exceljs";
import PDFDocument from "pdfkit";
import { csvCell } from "../reports/report-renderer";

export interface QcExportTable { key: string; title: string; columns: string[]; rows: Array<Array<string | number | null>>; }
export interface QcExportDocument { title: string; company: string; color: string; generatedAt: string; scope: string; tables: QcExportTable[]; }
const display = (value: string | number | null) => value === null ? "Not measurable" : String(value);
export async function renderQcExport(model: QcExportDocument, format: "csv" | "xlsx" | "pdf"): Promise<Buffer> {
  if (format === "csv") return Buffer.from("\uFEFF" + [[model.title], [model.company], [model.scope], [model.generatedAt], ...model.tables.flatMap(table => [[], [table.title], table.columns, ...table.rows.map(row => row.map(display))])].map(row => row.map(csvCell).join(",")).join("\r\n"));
  if (format === "xlsx") {
    const book = new Workbook(); book.creator = model.company; book.created = new Date(model.generatedAt);
    for (const table of model.tables) {
      const sheet = book.addWorksheet(table.title.slice(0, 31));
      sheet.addRow([model.title]); sheet.addRow([model.company]); sheet.addRow([model.scope]); sheet.addRow([`Generated ${model.generatedAt}`]); sheet.addRow([]);
      const header = sheet.addRow(table.columns); header.font = { bold: true, color: { argb: "FFFFFFFF" } }; header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + model.color.slice(1) } };
      for (const row of table.rows) sheet.addRow(row.map(value => value === null ? "Not measurable" : value));
      sheet.columns.forEach((column, index) => { column.width = Math.min(70, Math.max(18, table.columns[index]?.length + 4 || 18, ...table.rows.map(row => Math.min(65, display(row[index] ?? null).length + 2)))); column.alignment = { vertical: "top", wrapText: true }; });
      sheet.views = [{ state: "frozen", ySplit: 6 }]; sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: table.columns.length } };
      sheet.getRow(1).font = { bold: true, size: 16 }; sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true, info: { Title: model.title, Author: model.company } });
    const chunks: Buffer[] = []; doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const width = doc.page.width - 72, bottom = doc.page.height - 55;
    const pageHeader = () => { doc.x = 36; doc.fillColor(model.color).font("Helvetica-Bold").fontSize(16).text(model.title); doc.fillColor("#334155").font("Helvetica").fontSize(9).text(model.company).text(model.scope).text(`Generated ${model.generatedAt}`).moveDown(); };
    pageHeader();
    for (const table of model.tables) {
      if (doc.y > bottom - 80) { doc.addPage(); pageHeader(); }
      const cellWidth = width / table.columns.length;
      const header = () => { doc.x = 36; doc.font("Helvetica-Bold").fontSize(12).fillColor(model.color).text(table.title).moveDown(.5); const y = doc.y; doc.rect(36, y, width, 32).fill("#EDF2F7"); table.columns.forEach((value, index) => doc.fillColor("#172033").fontSize(9).text(value, 41 + index * cellWidth, y + 5, { width: cellWidth - 10, height: 27 })); doc.y = y + 36; };
      header();
      for (const row of table.rows) {
        doc.font("Helvetica").fontSize(9);
        const height = Math.max(25, ...row.map(value => doc.heightOfString(display(value), { width: cellWidth - 12 }) + 12));
        if (doc.y + height > bottom) { doc.addPage(); pageHeader(); header(); doc.font("Helvetica").fontSize(9); }
        const y = doc.y; row.forEach((value, index) => doc.fillColor("#172033").text(display(value), 41 + index * cellWidth, y + 5, { width: cellWidth - 12 }));
        doc.moveTo(36, y + height).lineTo(36 + width, y + height).strokeColor("#D9E1EB").stroke(); doc.y = y + height + 2;
      }
      doc.x = 36; doc.moveDown(1);
    }
    const range = doc.bufferedPageRange(); for (let page = range.start; page < range.start + range.count; page++) { doc.switchToPage(page); const margin = doc.page.margins.bottom; doc.page.margins.bottom = 0; doc.fontSize(8).fillColor("#52627A").text(`Page ${page + 1} of ${range.count}`, 36, doc.page.height - 36, { width, align: "right", lineBreak: false }); doc.page.margins.bottom = margin; }
    doc.end();
  });
}
