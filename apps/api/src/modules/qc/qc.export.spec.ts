import { Workbook } from "exceljs";
import { renderQcExport, QcExportDocument } from "./qc.export";
import { reopenMetrics } from "./qc.reports.service";
const model: QcExportDocument = { title: "Synthetic quality report", company: "Synthetic organization", color: "#235AAA", generatedAt: "2026-10-07T12:00:00.000Z", scope: "Synthetic scope only", tables: [{ key: "quality", title: "Quality", columns: ["Technician", "Score", "Unknown"], rows: [["=HYPERLINK(\"unsafe\")", 95.5, null], ...Array.from({ length: 100 }, (_, index) => [`Synthetic technician ${index}`, index, "Verified evidence"])] }] };
describe("QC report rendering and honest historical denominators", () => {
  it("does not represent unknown historical reopen data as zero", () => {
    expect(reopenMetrics([{ measurement: { observed: { origin: "HISTORICAL", reopened: false } } }])).toEqual({ reopenedCycles: 0, observedCycles: 0, unknownCycles: 1, reopenCyclePercent: null });
    expect(reopenMetrics([{ measurement: {} }, { measurement: { observed: { origin: "CAPTURED", reopened: true } } }, { measurement: { observed: { origin: "CAPTURED", reopened: false } } }])).toMatchObject({ unknownCycles: 1, observedCycles: 2, reopenCyclePercent: 50 });
  });
  it("escapes spreadsheet formulas in CSV and states unmeasurable values", async () => {
    const csv = (await renderQcExport(model, "csv")).toString(); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("Not measurable"); expect(csv).toContain("Synthetic scope only");
  });
  it("keeps Excel values numeric, malicious-looking strings inert, and headers frozen", async () => {
    const bytes = await renderQcExport(model, "xlsx"); const book = new Workbook(); await book.xlsx.load(bytes as never);
    const sheet = book.getWorksheet("Quality")!; expect(sheet.rowCount).toBe(107); expect(sheet.getCell("B7").value).toBe(95.5); expect(sheet.getCell("A7").value).toBe('=HYPERLINK("unsafe")'); expect(sheet.getCell("C7").value).toBe("Not measurable"); expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
  });
  it("keeps a short report and its footer on one page", async () => {
    const bytes = await renderQcExport({ ...model, tables: [{ ...model.tables[0], rows: [["Synthetic technician", 90, null]] }] }, "pdf");
    expect((bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });
  it("creates a multipage PDF with bounded table content", async () => {
    const bytes = await renderQcExport(model, "pdf"); expect(bytes.subarray(0, 4).toString()).toBe("%PDF"); expect((bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(2); expect(bytes.subarray(-10).toString()).toContain("%%EOF");
  });
});
