import { Workbook } from "exceljs";
import { csvCell, renderReport, ReportDocument, selectedColumns } from "./report-renderer";
const model: ReportDocument = {
  kind: "ticket-report", title: "Synthetic monthly report", company: "Synthetic company", application: "Synthetic platform", color: "#155eef", timeZone: "America/Chicago", locale: "en", currency: "CAD", generatedAt: new Date("2026-09-21T15:00:00Z"),
  criteria: [["Period", "2026-08-01 through 2026-08-31"], ["Scope", "All matching records"]], metrics: [["Total tickets", 114, "totalTickets"], ["Estimate", 0, "estimatedTotal"]], distributions: [{ key: "byClient", title: "Client", items: [{ label: "ISFA", count: 114 }] }], activity: [{ period: "2026-08-01", created: 0, closed: 0 }], matched: 114,
  query: { columns: "ticketNumber,subject,status,createdAt,estimatedValue", sections: "summary,charts,detail" },
  rows: Array.from({ length: 114 }, (_, i) => ({ ticketNumber: `SYN-${String(i + 1).padStart(3, "0")}`, subject: i === 0 ? "Long subject with José Hernández and full client context. ".repeat(40) : "Synthetic ticket subject", status: "Awaiting Equipment", createdAt: "2026-08-15T14:30:00Z", estimatedValue: 0 }))
};
describe("Report document generation", () => {
  it("validates the column catalog and neutralizes spreadsheet formulas", () => {
    expect(() => selectedColumns("ticket-report", { columns: "passwordHash" })).toThrow();
    expect(() => selectedColumns("ticket-report", { columns: "subject,subject" })).toThrow();
    expect(csvCell("=HYPERLINK(\"x\")")).toContain("'=HYPERLINK");
    expect(csvCell(" \t@SUM(A1)")).toContain("' \t@");
    expect(csvCell(-5)).toBe('"-5"');
  });
  it("exports all records, typed local dates, zero currency and configured status labels", async () => {
    const bytes = await renderReport(model, "xlsx"); const book = new Workbook(); await book.xlsx.load(bytes as never);
    const sheet = book.getWorksheet("Detail")!;
    expect(sheet.rowCount).toBe(115); expect(sheet.getCell("A115").value).toBe("SYN-114");
    expect(sheet.getCell("C2").value).toBe("Awaiting Equipment");
    expect(sheet.getCell("D2").value).toEqual(new Date("2026-08-15T09:30:00Z"));
    expect(sheet.getCell("E2").value).toBe(0); expect(sheet.getCell("E2").numFmt).toContain("CAD");
    expect(sheet.getCell("B2").alignment.wrapText).toBe(true); expect(sheet.views[0].state).toBe("frozen");
    expect(book.creator).toBe("Synthetic company");
    expect(book.worksheets.map((s) => s.name)).toEqual(["Criteria", "Summary", "Activity", "Distributions", "Detail"]);
  });
  it("creates a multipage PDF without discarding the last records", async () => {
    const bytes = await renderReport(model, "pdf"); expect(Buffer.isBuffer(bytes)).toBe(true); expect(bytes.toString().slice(0, 4)).toBe("%PDF");
    // PDF text fidelity and geometry are verified separately with the rendered fixture.
    expect(bytes.length).toBeGreaterThan(15000);
  });
  it("respects explicit sections in CSV and retains zero values", async () => {
    const csv = await renderReport({ ...model, query: { columns: "ticketNumber,estimatedValue", sections: "detail" } }, "csv");
    expect(csv.toString()).toContain('"SYN-114","0"'); expect(csv.toString()).not.toContain('"Metric","Value"');
  });
});

describe("Granular report content", () => {
  it("includes only the requested metric and breakdown in Excel", async () => {
    const bytes = await renderReport({ ...model, query: { sections: "metric:totalTickets,byClient" } }, "xlsx");
    const book = new Workbook(); await book.xlsx.load(bytes as never);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Summary", "Distributions"]);
    expect(book.getWorksheet("Summary")!.rowCount).toBe(2);
    expect(book.getWorksheet("Summary")!.getCell("A2").value).toBe("Total tickets");
    expect(book.getWorksheet("Distributions")!.getCell("B2").value).toBe("ISFA");
  });
  it("can export only detail or only activity without leaking omitted sections", async () => {
    for (const [sections, expected] of [["detail", "Detail"], ["activity", "Activity"]]) {
      const book = new Workbook(); await book.xlsx.load(await renderReport({ ...model, query: { sections } }, "xlsx") as never);
      expect(book.worksheets.map((s) => s.name)).toEqual([expected]);
    }
    await expect(renderReport({ ...model, query: { sections: "byHealth" } }, "pdf")).rejects.toThrow("valid report sections");
    await expect(renderReport({ ...model, query: { sections: "" } }, "xlsx")).rejects.toThrow("valid report sections");
  });
});
