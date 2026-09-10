import { describe, expect, it } from "vitest";
import { detectWorkbookLayout } from "./detector";

describe("detectWorkbookLayout", () => {
  it("detects both New and Old device groups in the collection layout", () => {
    const analysis = detectWorkbookLayout({
      sheets: [{
        name: "Sheet1",
        rows: [
          ["No", "User Name", "Department", "NewSerialNumber", "New Model", "Device Type", "OldSerialNumber", "Old Model"],
          [1, "Person A", "Ops", "5CG1234ABC", "HP EliteBook 840 G8", "Laptop", "1CZ00306R3", "HP ProDesk 400 G6"],
          [2, "Person B", "IT", "5CG9999XYZ", "HP EliteBook 830 G7", "Laptop", "MXL1234567", "HP ProBook 440 G5"],
        ],
      }],
    });

    expect(analysis.mappings.map((mapping) => ({
      serial: mapping.serialColumnIndex,
      model: mapping.modelColumnIndex,
      role: mapping.role,
    }))).toEqual([
      { serial: 3, model: 4, role: "New" },
      { serial: 6, model: 7, role: "Old" },
    ]);
    expect(analysis.needsConfirmation).toBe(false);
  });

  it("detects Appendix 3A after title rows and relates existing CPU and RAM columns", () => {
    const analysis = detectWorkbookLayout({
      sheets: [{
        name: "Appendix 3A",
        rows: [
          ["Appendix 3A - Asset Listing"],
          [],
          ["No.", "Serial no", "Asset", "Asset description", "CPU", "RAM"],
          [1, "1CZ00306R3", "A-001", "HP ProDesk 400 G6 SFF", "", ""],
          [2, "5CG1234ABC", "A-002", "HP EliteBook 840 G8", "", ""],
        ],
      }],
    });

    expect(analysis.mappings).toHaveLength(1);
    expect(analysis.mappings[0]).toMatchObject({
      sheetName: "Appendix 3A",
      headerRowIndex: 2,
      serialColumnIndex: 1,
      cpuColumnIndex: 4,
      ramColumnIndex: 5,
    });
  });

  it("finds three serial columns and derives roles from merged group headings", () => {
    const analysis = detectWorkbookLayout({
      sheets: [{
        name: "Moves",
        mergedRanges: [
          { startRow: 0, endRow: 0, startColumn: 1, endColumn: 2 },
          { startRow: 0, endRow: 0, startColumn: 3, endColumn: 4 },
          { startRow: 0, endRow: 0, startColumn: 5, endColumn: 6 },
        ],
        rows: [
          ["No", "Current Device", "", "Replacement Device", "", "Loan Device", ""],
          ["", "Serial Number", "Model", "S/N", "Model", "Service Tag", "Model"],
          [1, "5CG1234ABC", "EliteBook", "MXL1234567", "ProBook", "CND7654321", "ZBook"],
          [2, "5CG9999XYZ", "EliteBook", "MXL9999999", "ProBook", "CND1111111", "ZBook"],
        ],
      }],
    });

    expect(analysis.mappings.map((mapping) => mapping.role)).toEqual([
      "Current Device",
      "Replacement Device",
      "Loan Device",
    ]);
  });

  it("collects mappings from every relevant worksheet", () => {
    const analysis = detectWorkbookLayout({
      sheets: [
        { name: "Laptops", rows: [["Serial", "Model"], ["5CG1234ABC", "EliteBook"], ["5CG9999XYZ", "EliteBook"]] },
        { name: "Desktops", rows: [["Asset", "HP Serial Number"], ["A1", "1CZ00306R3"], ["A2", "MXL1234567"]] },
        { name: "Notes", rows: [["Description", "Quantity"], ["Collect", 20]] },
      ],
    });

    expect(analysis.mappings.map((mapping) => mapping.sheetName)).toEqual(["Laptops", "Desktops"]);
  });

  it("does not mistake numeric asset, quantity, or date columns for serial numbers", () => {
    const analysis = detectWorkbookLayout({
      sheets: [{
        name: "Stock",
        rows: [
          ["Asset No", "Quantity", "Collection Date", "Description"],
          [10001, 5, "2026-09-10", "Desktop"],
          [10002, 8, "2026-09-11", "Laptop"],
        ],
      }],
    });

    expect(analysis.mappings).toEqual([]);
  });

  it("flags a weak value-only serial candidate for confirmation", () => {
    const analysis = detectWorkbookLayout({
      sheets: [{
        name: "Unknown",
        rows: [
          ["Device ID", "Type"],
          ["5CG1234ABC", "Laptop"],
          ["5CG9999XYZ", "Laptop"],
        ],
      }],
    });

    expect(analysis.mappings).toHaveLength(1);
    expect(analysis.needsConfirmation).toBe(true);
    expect(analysis.mappings[0].confidence).toBeLessThan(0.85);
  });
});
