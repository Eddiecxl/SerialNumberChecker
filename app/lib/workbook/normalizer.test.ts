import { describe, expect, it } from "vitest";
import { detectWorkbookLayout } from "./detector";
import { normalizeDevices } from "./normalizer";
import type { WorkbookProfile } from "./types";

const profile: WorkbookProfile = {
  sheets: [{
    name: "Collection",
    rows: [
      ["No", "User Name", "NewSerialNumber", "New Model", "OldSerialNumber", "Old Model"],
      [1, "Person A", "5cg-1234-abc", "EliteBook 840", "1CZ00306R3", "ProDesk 400"],
      [2, "Person B", "5CG1234ABC", "EliteBook 840", "MXL1234567", "ProBook 440"],
    ],
  }],
};

describe("normalizeDevices", () => {
  it("creates one traceable record for every mapped device cell", () => {
    const records = normalizeDevices(profile, detectWorkbookLayout(profile));

    expect(records).toHaveLength(4);
    expect(records.map(({ role, serialNumber, modelHint, sourceRow }) => ({ role, serialNumber, modelHint, sourceRow }))).toEqual([
      { role: "New", serialNumber: "5cg-1234-abc", modelHint: "EliteBook 840", sourceRow: 2 },
      { role: "Old", serialNumber: "1CZ00306R3", modelHint: "ProDesk 400", sourceRow: 2 },
      { role: "New", serialNumber: "5CG1234ABC", modelHint: "EliteBook 840", sourceRow: 3 },
      { role: "Old", serialNumber: "MXL1234567", modelHint: "ProBook 440", sourceRow: 3 },
    ]);
    expect(records[0].sourceGroupKey).toBe("Collection:2");
  });

  it("retains duplicate occurrences while normalizing their lookup key", () => {
    const records = normalizeDevices(profile, detectWorkbookLayout(profile));
    expect(records[0].normalizedSerial).toBe("5CG1234ABC");
    expect(records[2].normalizedSerial).toBe("5CG1234ABC");
    expect(records[0].id).not.toBe(records[2].id);
  });

  it("produces 430 devices from 215 complete New and Old rows", () => {
    const rows = [["New Serial", "New Model", "Old Serial", "Old Model"]];
    for (let index = 0; index < 215; index += 1) {
      rows.push([`5CG${String(index).padStart(7, "0")}`, "New Model", `MXL${String(index).padStart(7, "0")}`, "Old Model"]);
    }
    const large: WorkbookProfile = { sheets: [{ name: "Sheet1", rows }] };
    expect(normalizeDevices(large, detectWorkbookLayout(large))).toHaveLength(430);
  });
});
