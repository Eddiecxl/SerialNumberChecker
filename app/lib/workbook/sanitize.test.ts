import { describe, expect, it } from "vitest";
import { sanitizeWorkbookProfile, validateSuggestedMappings } from "./sanitize";
import type { WorkbookProfile } from "./types";

const profile: WorkbookProfile = {
  sheets: [{
    name: "Collection",
    rows: [
      ["User Name", "Department", "Device ID", "Model"],
      ["Eddie Chan", "Finance", "5CG1234ABC", "EliteBook 840"],
      ["Alice Lim", "Operations", "1CZ00306R3", "ProDesk 400"],
    ],
  }],
};

describe("sanitizeWorkbookProfile", () => {
  it("keeps structural headers but never sends personal or full serial values", () => {
    const sanitized = sanitizeWorkbookProfile(profile);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain("Device ID");
    expect(serialized).toContain("Model");
    expect(serialized).not.toContain("Eddie");
    expect(serialized).not.toContain("Finance");
    expect(serialized).not.toContain("5CG1234ABC");
    expect(sanitized.sheets[0].columns[2].samples[0]).toBe("AAA9999AAA:length=10");
  });
});

describe("validateSuggestedMappings", () => {
  it("accepts only mappings that point to real serial-like workbook columns", () => {
    expect(validateSuggestedMappings(profile, [{
      sheetName: "Collection",
      headerRowIndex: 0,
      serialColumnIndex: 2,
      role: "Primary",
      modelColumnIndex: 3,
      usernameColumnIndex: 0,
      departmentColumnIndex: 1,
    }])).toHaveLength(1);

    expect(() => validateSuggestedMappings(profile, [{
      sheetName: "Collection",
      headerRowIndex: 0,
      serialColumnIndex: 99,
      role: "Primary",
    }])).toThrow("outside the workbook");

    expect(() => validateSuggestedMappings(profile, [{
      sheetName: "Collection",
      headerRowIndex: 0,
      serialColumnIndex: 0,
      role: "Primary",
    }])).toThrow("serial-like");
  });
});
