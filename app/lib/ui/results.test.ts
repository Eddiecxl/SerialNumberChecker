import { describe, expect, it } from "vitest";
import { buildEvidenceRows, groupStartIndexes } from "./results";

describe("groupStartIndexes", () => {
  it("marks the first device from each original workbook row", () => {
    expect(groupStartIndexes([
      { sourceGroupKey: "Sheet1:2" },
      { sourceGroupKey: "Sheet1:2" },
      { sourceGroupKey: "Sheet1:3" },
    ])).toEqual(new Set([0, 2]));
  });
});

describe("buildEvidenceRows", () => {
  it("keeps HP descriptions and part numbers together without blank rows", () => {
    const rows = buildEvidenceRows([{
      field: "ram",
      normalizedValue: "16 GB DDR4",
      evidence: [
        { hpDescription: "SKU-UDIMM 16GB DDR4", hpPartNumber: "L123", quantity: "1", evidenceType: "compatible-spare", serialSpecific: false },
        { hpDescription: "", hpPartNumber: "", quantity: "", evidenceType: "compatible-spare", serialSpecific: false },
      ],
    }]);
    expect(rows).toEqual([{
      field: "RAM",
      value: "16 GB DDR4",
      description: "SKU-UDIMM 16GB DDR4",
      partNumber: "L123",
      evidenceType: "compatible-spare",
      serialSpecific: false,
    }]);
  });
});
