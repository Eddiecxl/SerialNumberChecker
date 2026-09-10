import { describe, expect, it } from "vitest";
import { resolveProduct } from "./product-resolver";
import { parseSpecifications } from "./spec-parser";
import { validateDevice } from "./validation";
import { extractProductCandidates } from "./payload-adapter";
import type { HpProductCandidate } from "./types";

const candidate = (productNumber: string, productName: string, serialNumber = ""): HpProductCandidate => ({
  productNumber,
  productName,
  serialNumber,
  unitConfiguration: [],
  spareParts: [],
});

describe("resolveProduct", () => {
  const candidates = [
    candidate("6EF22AV", "HP ProDesk 400 G6 SFF", "1CZ00306R3"),
    candidate("8AA11AV", "HP ProDesk 400 G7 SFF", ""),
  ];

  it("uses exact product number before other candidate signals", () => {
    const result = resolveProduct(candidates, { serial: "UNKNOWN1", productNumberHint: "8aa11av", modelHint: "HP ProDesk 400 G6 SFF" });
    expect(result.selected?.productNumber).toBe("8AA11AV");
    expect(result.matchMethod).toBe("product-number");
  });

  it("uses serial identity, then exact normalized model, then a unique candidate", () => {
    expect(resolveProduct(candidates, { serial: "1cz00306r3" }).matchMethod).toBe("serial-identity");
    expect(resolveProduct(candidates, { serial: "OTHER123", modelHint: "hp prodesk 400 g7 sff" }).matchMethod).toBe("model-exact");
    expect(resolveProduct([candidates[0]], { serial: "OTHER123" }).matchMethod).toBe("unique-candidate");
  });

  it("never guesses between unresolved candidates", () => {
    const result = resolveProduct(candidates, { serial: "OTHER123", modelHint: "ProDesk" });
    expect(result.selected).toBeUndefined();
    expect(result.status).toBe("REVIEW REQUIRED");
    expect(result.candidates).toHaveLength(2);
  });

  it("marks zero candidates unresolved", () => {
    expect(resolveProduct([], { serial: "1CZ00306R3" }).status).toBe("UNRESOLVED");
  });

  it("uniquely matches HP's abbreviated product description from workbook model identifiers", () => {
    const result = resolveProduct([
      candidate("8M4X3AV", "BU IDS UMA U7-155U RTKUSBC 840 G11", "5CG5124NY0"),
      candidate("K9H95EA", "H350G2U34030UQX500NXNCN04NNPa ALL", "5CG5124NY0"),
    ], { serial: "5CG5124NY0", modelHint: "HP ELITEBOOK 840 G11" });

    expect(result.selected?.productNumber).toBe("8M4X3AV");
    expect(result.matchMethod).toBe("model-signature");
  });
});

describe("parseSpecifications", () => {
  it("preserves normalized CPU and installed RAM with HP descriptions and part numbers", () => {
    const specs = parseSpecifications({
      unitConfiguration: [
        { part_number: "L12345-001", part_description: "Intel Core i5-9500 6C 3.0GHz 65W" },
        { part_number: "L16399-001", part_description: "UDIMM 8GB 1.2v DDR4-2666 NECC" },
        { part_number: "L16399-002", part_description: "UDIMM 8GB 1.2v DDR4-2666 NECC" },
      ],
      spareParts: [],
    });

    const cpu = specs.find((spec) => spec.field === "cpu");
    const ram = specs.find((spec) => spec.field === "ram");
    expect(cpu).toMatchObject({ normalizedValue: "Intel Core i5-9500, 6 cores, 3.0 GHz, 65 W", hpPartNumber: "L12345-001", evidenceType: "serial-bom" });
    expect(ram?.normalizedValue).toContain("8 GB, DDR4-2666");
    expect(ram?.evidence).toHaveLength(2);
    expect(ram?.serialSpecific).toBe(true);
  });

  it("returns reviewable RAM evidence when HP lists multiple compatible DDR4 spares", () => {
    const specs = parseSpecifications({
      unitConfiguration: [],
      spareParts: [
        { spare_part_number: "L16399-001", spare_part_description: "SKU-UDIMM 16GB 1.2v DDR4-2666 NECC" },
        { spare_part_number: "L82038-001", spare_part_description: "SKU-UDIMM 16GB 1.2v DDR4-3200 NECC" },
      ],
    });
    const ram = specs.find((spec) => spec.field === "ram");
    expect(ram?.normalizedValue).toContain("16 GB");
    expect(ram?.normalizedValue).toContain("Review");
    expect(ram?.evidenceType).toBe("compatible-spare");
    expect(ram?.evidence.map((item) => item.hpPartNumber)).toEqual(["L16399-001", "L82038-001"]);
  });

  it("categorizes broad HP component information", () => {
    const specs = parseSpecifications({
      unitConfiguration: [
        { part_number: "SSD1", part_description: "SSD 512GB M.2 NVMe" },
        { part_number: "GPU1", part_description: "NVIDIA GeForce RTX Graphics" },
        { part_number: "BAT1", part_description: "Battery 3-cell 53Wh" },
        { part_number: "WLAN1", part_description: "Intel Wi-Fi WLAN Bluetooth" },
        { part_number: "PWR1", part_description: "AC Adapter 65W USB-C" },
        { part_number: "KBD1", part_description: "Keyboard UK backlit" },
      ],
      spareParts: [],
    });
    expect(specs.map((spec) => spec.category)).toEqual(["storage", "graphics", "battery", "network", "power", "keyboard"]);
  });
});

describe("validateDevice", () => {
  it("verifies serial-specific CPU and RAM but reviews spare-only RAM", () => {
    const resolution = resolveProduct([candidate("6EF22AV", "HP ProDesk")], { serial: "1CZ00306R3" });
    const installed = parseSpecifications({
      unitConfiguration: [
        { part_description: "Intel Core i5-9500 6C 3.0GHz 65W" },
        { part_description: "UDIMM 8GB DDR4-2666 NECC" },
      ], spareParts: [],
    });
    expect(validateDevice(resolution, installed).status).toBe("VERIFIED");

    const spareOnly = parseSpecifications({
      unitConfiguration: [{ part_description: "Intel Core i5-9500 6C 3.0GHz 65W" }],
      spareParts: [{ spare_part_description: "SKU-UDIMM 8GB DDR4-2666 NECC" }],
    });
    expect(validateDevice(resolution, spareOnly)).toMatchObject({ status: "REVIEW REQUIRED" });
  });
});

describe("extractProductCandidates", () => {
  it("adapts both single and multiple HP BOM response shapes", () => {
    const single = extractProductCandidates({ Body: { SerialNumberBOM: {
      wwsnrsinput: { product_no: "6EF22AV", user_name: "HP ProDesk" },
      unit_configuration: [{ part_description: "Intel Core i5-9500" }],
      spare_part: [],
    } } }, "1CZ00306R3");
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ productNumber: "6EF22AV", productName: "HP ProDesk", serialNumber: "1CZ00306R3" });

    const multiple = extractProductCandidates({ Body: { SerialNumberBOMs: [
      { wwsnrsinput: { product_no: "A1", user_name: "Model A", serial_number: "SERIAL001" }, unit_configuration: [], spare_part: [] },
      { wwsnrsinput: { product_no: "B2", user_name: "Model B" }, unit_configuration: [], spare_part: [] },
    ] } }, "SERIAL001");
    expect(multiple.map((item) => item.productNumber)).toEqual(["A1", "B2"]);
  });

  it("adapts HP's multiple-product selection list before a BOM is loaded", () => {
    const candidates = extractProductCandidates({ Body: { SNRProductLists: [
      { product_Id: "8M4X3AV", product_Desc: "BU IDS UMA U7-155U RTKUSBC 840 G11" },
      { product_Id: "K9H95EA", product_Desc: "H350G2U34030UQX500NXNCN04NNPa ALL" },
    ] } }, "5CG5124NY0");

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      productNumber: "8M4X3AV",
      productName: "BU IDS UMA U7-155U RTKUSBC 840 G11",
      serialNumber: "5CG5124NY0",
      unitConfiguration: [],
      spareParts: [],
    });
  });
});
