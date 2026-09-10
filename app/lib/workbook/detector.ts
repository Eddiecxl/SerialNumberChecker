import type {
  ColumnMapping,
  LayoutAnalysis,
  MergedRangeProfile,
  WorkbookProfile,
  WorksheetProfile,
} from "./types";

const AUTO_ACCEPT_CONFIDENCE = 0.85;
const SERIAL_HEADERS = ["serial", "serial no", "serial number", "s n", "sn", "service tag"];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function words(value: unknown): string {
  return text(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeSerial(value: unknown): string {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isSerialLike(value: unknown): boolean {
  const original = text(value);
  if (/\s/.test(original)) return false;
  const serial = normalizeSerial(original);
  return serial.length >= 7
    && serial.length <= 20
    && /[A-Z]/.test(serial)
    && /\d/.test(serial)
    && !/^\d+$/.test(serial);
}

function serialHeaderStrength(label: string): "strong" | "weak" | null {
  if (SERIAL_HEADERS.some((alias) => label === alias || label.includes(`${alias} `) || label.endsWith(` ${alias}`))) {
    return "strong";
  }
  if (/\b(serial|service tag)\b/.test(label)) return "strong";
  if (/\b(device id|device identifier)\b/.test(label)) return "weak";
  return null;
}

function serialDensity(sheet: WorksheetProfile, headerRow: number, column: number): number {
  const values = sheet.rows
    .slice(headerRow + 1, headerRow + 31)
    .map((row) => row[column])
    .filter((value) => text(value) !== "");
  if (!values.length) return 0;
  return values.filter(isSerialLike).length / values.length;
}

function mergedHeading(
  sheet: WorksheetProfile,
  headerRow: number,
  column: number,
): string {
  const ranges = sheet.mergedRanges ?? [];
  const range = ranges.find((candidate: MergedRangeProfile) => (
    candidate.startRow < headerRow
    && candidate.endRow < headerRow
    && candidate.startColumn <= column
    && candidate.endColumn >= column
  ));
  if (range) return text(sheet.rows[range.startRow]?.[range.startColumn]);

  for (let row = headerRow - 1; row >= Math.max(0, headerRow - 2); row -= 1) {
    const direct = text(sheet.rows[row]?.[column]);
    if (direct) return direct;
  }
  return "";
}

function roleFromHeader(sheet: WorksheetProfile, row: number, column: number): string {
  const original = text(sheet.rows[row]?.[column]).replace(/([a-z])([A-Z])/g, "$1 $2");
  const stripped = original
    .replace(/serial\s*(number|no\.?|#)?/ig, "")
    .replace(/s\s*[/.-]?\s*n/ig, "")
    .replace(/service\s+tag/ig, "")
    .trim();
  if (stripped && !/^(hp|device)$/i.test(stripped)) return titleCase(stripped);
  return mergedHeading(sheet, row, column) || "Primary";
}

function headerLabels(sheet: WorksheetProfile, row: number): string[] {
  return (sheet.rows[row] ?? []).map(words);
}

function relatedColumn(
  sheet: WorksheetProfile,
  headerRow: number,
  serialColumn: number,
  role: string,
  matcher: (label: string) => boolean,
): number | undefined {
  const labels = headerLabels(sheet, headerRow);
  const roleWords = words(role);
  const candidates = labels
    .map((label, index) => ({
      index,
      label,
      score: matcher(label)
        ? (Math.max(0, 5 - Math.abs(index - serialColumn))
          + (roleWords !== "primary" && label.includes(roleWords) ? 10 : 0)
          + (mergedHeading(sheet, headerRow, index) === role ? 8 : 0))
        : -1,
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.index;
}

function mappingFor(
  sheet: WorksheetProfile,
  headerRowIndex: number,
  serialColumnIndex: number,
  strength: "strong" | "weak",
  density: number,
): ColumnMapping {
  const role = roleFromHeader(sheet, headerRowIndex, serialColumnIndex);
  const confidence = Math.min(0.99, strength === "strong" ? 0.76 + density * 0.2 : 0.42 + density * 0.32);
  const column = (match: (label: string) => boolean) => relatedColumn(
    sheet,
    headerRowIndex,
    serialColumnIndex,
    role,
    match,
  );

  return {
    sheetName: sheet.name,
    headerRowIndex,
    serialColumnIndex,
    role,
    modelColumnIndex: column((label) => /\b(model|product name)\b/.test(label)),
    productNumberColumnIndex: column((label) => /\b(product number|product no|sku|product id)\b/.test(label)),
    deviceTypeColumnIndex: column((label) => /\b(device type|form factor|type)\b/.test(label)),
    assetColumnIndex: column((label) => /\b(asset|asset no|asset number)\b/.test(label)),
    cpuColumnIndex: column((label) => /\b(cpu|processor)\b/.test(label)),
    ramColumnIndex: column((label) => /\b(ram|memory)\b/.test(label)),
    confidence,
    matchReason: strength === "strong"
      ? `Recognized serial header with ${Math.round(density * 100)}% serial-like values`
      : `Serial-like values found under ambiguous device identifier header`,
  };
}

export function detectWorkbookLayout(profile: WorkbookProfile): LayoutAnalysis {
  const mappings: ColumnMapping[] = [];
  const warnings: string[] = [];

  for (const sheet of profile.sheets) {
    const bestByColumn = new Map<number, ColumnMapping>();
    const rowLimit = Math.min(sheet.rows.length, 40);
    for (let row = 0; row < rowLimit; row += 1) {
      const labels = headerLabels(sheet, row);
      labels.forEach((label, column) => {
        const strength = serialHeaderStrength(label);
        if (!strength) return;
        const density = serialDensity(sheet, row, column);
        if (density < 0.5) return;
        const mapping = mappingFor(sheet, row, column, strength, density);
        const current = bestByColumn.get(column);
        if (!current || mapping.confidence > current.confidence) bestByColumn.set(column, mapping);
      });
    }
    mappings.push(...[...bestByColumn.values()].sort((a, b) => a.serialColumnIndex - b.serialColumnIndex));
  }

  const weak = mappings.filter((mapping) => mapping.confidence < AUTO_ACCEPT_CONFIDENCE);
  if (weak.length) warnings.push(`${weak.length} serial column mapping${weak.length === 1 ? "" : "s"} require confirmation.`);
  if (!mappings.length) warnings.push("No reliable serial number column was detected.");

  return {
    mappings,
    needsConfirmation: weak.length > 0 || mappings.length === 0,
    warnings,
  };
}
