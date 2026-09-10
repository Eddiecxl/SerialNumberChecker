import { describe, expect, it } from "vitest";
import { buildReviewRows, buildSpecResultRows } from "./results";

const device = (index: number, role: "New" | "Old", validationStatus = "supported") => ({
  sourceSheet: "Sheet1",
  sourceRow: index + 2,
  role,
  serialNumber: `${role === "New" ? "5CG" : "MXL"}${String(index).padStart(7, "0")}`,
  modelHint: `${role} source model`,
  productNumberHint: `${role}-SKU`,
  asset: `A-${index}`,
  description: `${role} source model`,
  productNumber: "HP-SKU",
  productName: "HP resolved model",
  cpu: "Intel Core i5",
  ram: "16 GB, DDR4-3200",
  validationStatus,
  reviewReason: validationStatus === "supported" ? "" : "Compatible spare only",
  resolution: { matchMethod: "product-number", reason: "Exact SKU", candidateCount: 1, candidates: [] },
  specifications: [{
    category: "storage", field: "storage", normalizedValue: "SSD 512GB NVMe", hpDescription: "SPS-SSD 512GB NVMe",
    hpPartNumber: "SSD-001", evidenceType: "serial-bom", serialSpecific: true,
    evidence: [{ hpDescription: "SPS-SSD 512GB NVMe", hpPartNumber: "SSD-001", quantity: "1", evidenceType: "serial-bom", serialSpecific: true }],
  }],
  cpuEvidence: ["Intel Core i5 processor"],
  ramEvidence: ["16GB DDR4-3200"],
  sourceUrl: "https://partsurfer.hp.com/example",
  lookupCountry: "Malaysia",
  lookedUpAt: "2026-09-10T00:00:00.000Z",
});

describe("buildSpecResultRows", () => {
  it("creates one normalized result row per New and Old device", () => {
    const rows = buildSpecResultRows([device(1, "New"), device(1, "Old")]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.Role, row.SerialNumber])).toEqual([
      ["New", "5CG0000001"],
      ["Old", "MXL0000001"],
    ]);
    expect(rows[0]).toMatchObject({
      SourceSheet: "Sheet1",
      SourceRow: 3,
      ValidationStatus: "VERIFIED",
      Storage: "SSD 512GB NVMe",
      EvidencePartNumbers: "SSD-001",
    });
  });

  it("creates 430 result rows for 215 complete New and Old source rows", () => {
    const devices = Array.from({ length: 215 }, (_, index) => [device(index, "New"), device(index, "Old")]).flat();
    expect(buildSpecResultRows(devices)).toHaveLength(430);
  });
});

describe("buildReviewRows", () => {
  it("includes only review and unresolved devices with an action", () => {
    const rows = buildReviewRows([
      device(1, "New", "supported"),
      device(2, "Old", "review"),
      device(3, "New", "unavailable"),
    ]);
    expect(rows.map((row) => row.ValidationStatus)).toEqual(["REVIEW REQUIRED", "UNRESOLVED"]);
    expect(rows.every((row) => Boolean(row.RecommendedAction))).toBe(true);
  });
});
