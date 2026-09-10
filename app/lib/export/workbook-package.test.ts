import JSZip from "jszip";
import XlsxPopulate from "xlsx-populate";
import { describe, expect, it } from "vitest";
import { ensureWorksheetContentTypes } from "./workbook-package";

describe("ensureWorksheetContentTypes", () => {
  it("adds standards-compliant content-type declarations for generated worksheets", async () => {
    const workbook = await XlsxPopulate.fromBlankAsync();
    workbook.addSheet("Spec Results");
    workbook.addSheet("Review Required");
    workbook.addSheet("Evidence Detail");

    const repaired = await ensureWorksheetContentTypes(await workbook.outputAsync() as ArrayBuffer);
    const zip = await JSZip.loadAsync(await repaired.arrayBuffer());
    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");

    for (let index = 1; index <= 4; index += 1) {
      expect(contentTypes).toContain(
        `PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"`,
      );
    }
  });
});
