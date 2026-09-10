import { isSerialLike, normalizeSerial } from "./detector";
import type { DeviceRecord, LayoutAnalysis, WorkbookProfile } from "./types";

function valueAt(row: unknown[], column: number | undefined): string | undefined {
  if (column === undefined) return undefined;
  const value = String(row[column] ?? "").trim();
  return value || undefined;
}

export function normalizeDevices(
  profile: WorkbookProfile,
  analysis: LayoutAnalysis,
): DeviceRecord[] {
  const devices: DeviceRecord[] = [];

  for (const mapping of analysis.mappings) {
    const sheet = profile.sheets.find((candidate) => candidate.name === mapping.sheetName);
    if (!sheet) continue;

    for (let rowIndex = mapping.headerRowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex] ?? [];
      const serialNumber = String(row[mapping.serialColumnIndex] ?? "").trim();
      if (!isSerialLike(serialNumber)) continue;
      const sourceRow = rowIndex + 1;
      devices.push({
        id: `${sheet.name}:${sourceRow}:${mapping.serialColumnIndex}:${mapping.role}`,
        serialNumber,
        normalizedSerial: normalizeSerial(serialNumber),
        role: mapping.role,
        sourceSheet: sheet.name,
        sourceRow,
        serialColumn: mapping.serialColumnIndex,
        sourceGroupKey: `${sheet.name}:${sourceRow}`,
        modelHint: valueAt(row, mapping.modelColumnIndex),
        productNumberHint: valueAt(row, mapping.productNumberColumnIndex),
        deviceTypeHint: valueAt(row, mapping.deviceTypeColumnIndex),
        assetHint: valueAt(row, mapping.assetColumnIndex),
        usernameHint: valueAt(row, mapping.usernameColumnIndex),
        departmentHint: valueAt(row, mapping.departmentColumnIndex),
      });
    }
  }

  return devices.sort((a, b) => (
    a.sourceSheet.localeCompare(b.sourceSheet)
    || a.sourceRow - b.sourceRow
    || a.serialColumn - b.serialColumn
  ));
}
