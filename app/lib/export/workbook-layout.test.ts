import XlsxPopulate from "xlsx-populate";
import { describe, expect, it } from "vitest";
import { writeResultWorksheets } from "./workbook-layout";

const rows = [{
  Role: "New",
  SerialNumber: "5CG0000001",
  SourceModel: "HP EliteBook",
  HPProductNumber: "8M4X3AV",
  HPProductName: "HP EliteBook 840 G11",
  CPU: "Intel Core Ultra 7 155U",
  RAM: "32 GB DDR5-5600",
  ValidationStatus: "VERIFIED",
  Storage: "1 TB PCIe NVMe SSD",
  Graphics: "Intel Graphics",
  Display: "14-inch WUXGA",
  Battery: "3-cell 56 Wh",
  Network: "Wi-Fi 6E",
  Power: "65 W USB-C",
  Keyboard: "Backlit keyboard",
  SystemBoard: "System board",
  OperatingSystem: "Windows 11 Pro",
  ReviewReason: "",
  SourceSheet: "Collection",
  SourceRow: 2,
  HPSource: "https://partsurfer.hp.com/example",
}];

describe("writeResultWorksheets", () => {
  it("creates readable result sheets without changing the uploaded source sheet", async () => {
    const workbook = await XlsxPopulate.fromBlankAsync();
    const source = workbook.sheet(0)!;
    source.name("Collection");
    source.cell("A1").value("Original layout").style({ bold: true, fill: "FFF2CC" });
    const sourceStyle = source.cell("A1").style("fill");

    const generated = writeResultWorksheets(workbook, {
      primaryRows: rows,
      reviewRows: [{
        Role: "Old", SerialNumber: "MXL0000001", SourceModel: "HP ZBook",
        HPProductNumber: "6CK22AV", HPProductName: "HP ZBook 17 G6",
        CPU: "Intel Core i7-9750H", RAM: "32 GB DDR4-2666",
        ValidationStatus: "REVIEW REQUIRED", ReviewReason: "Compatible spare evidence only",
        RecommendedAction: "Open the HP source and validate before sharing.",
        CandidateProducts: "6CK22AV: HP ZBook 17 G6", HPSource: "https://partsurfer.hp.com/review",
      }],
      evidenceRows: [{
        Role: "New", SerialNumber: "5CG0000001", SourceSheet: "Collection", SourceRow: 2,
        SourceModel: "HP EliteBook", SourceProductNumber: "8M4X3AV", SourceAsset: "A-001",
        HPProductNumber: "8M4X3AV", HPProductName: "HP EliteBook 840 G11",
        ValidationStatus: "VERIFIED", ReviewReason: "",
        MatchMethod: "product-number", CandidateCount: 1, CandidateProducts: "",
        CPUDescriptionEvidence: "Intel Core Ultra 7 155U", RAMDescriptionEvidence: "32 GB DDR5-5600",
        EvidencePartNumbers: "CPU-001 | RAM-001", EvidenceDescriptions: "Long HP BOM evidence",
        Optical: "", Audio: "Audio", OtherSpecifications: "", LookupCountry: "Malaysia",
        LookupTime: "2026-09-10T00:00:00.000Z", HPSource: "https://partsurfer.hp.com/example",
      }],
    });

    expect(generated).toEqual({
      primarySheetName: "Spec Results",
      reviewSheetName: "Review Required",
      evidenceSheetName: "Evidence Detail",
    });
    expect(workbook.sheet("Collection")!.cell("A1").value()).toBe("Original layout");
    expect(workbook.sheet("Collection")!.cell("A1").style("fill")).toEqual(sourceStyle);
    expect(workbook.sheet("Spec Results")!.cell("A1").value()).toBe("Device specification results");
    expect(workbook.sheet("Spec Results")!.cell("A4").value()).toBe("Role");
    expect(workbook.sheet("Spec Results")!.cell("B5").value()).toBe("5CG0000001");
    expect(workbook.sheet("Spec Results")!.cell("R5").value()).toBeUndefined();
    expect(workbook.sheet("Review Required")!.cell("A1").value()).toBe("Devices requiring review");
    expect(workbook.sheet("Evidence Detail")!.cell("A1").value()).toBe("HP lookup evidence detail");

    const output = await workbook.outputAsync();
    const reopened = await XlsxPopulate.fromDataAsync(output as ArrayBuffer);
    expect(reopened.sheet("Spec Results")!.cell("R5").value()).toBeUndefined();
    expect(reopened.sheet("Spec Results")!.panes()).toBeUndefined();
    expect(reopened.sheet("Review Required")!.panes()).toBeUndefined();
    expect(reopened.sheet("Evidence Detail")!.panes()).toBeUndefined();
  });
});
