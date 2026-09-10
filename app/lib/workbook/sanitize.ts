import { isSerialLike } from "./detector";
import type { ColumnMapping, WorkbookProfile } from "./types";

export interface SanitizedColumn {
  index: number;
  header: string;
  nonEmptyCount: number;
  serialLikeCount: number;
  samples: string[];
}

export interface SanitizedProfile {
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    candidateHeaderRows: Array<{
      rowIndex: number;
      columns: SanitizedColumn[];
    }>;
    columns: SanitizedColumn[];
  }>;
}

export interface SuggestedMapping {
  sheetName: string;
  headerRowIndex: number;
  serialColumnIndex: number;
  role?: string;
  modelColumnIndex?: number;
  productNumberColumnIndex?: number;
  deviceTypeColumnIndex?: number;
  assetColumnIndex?: number;
}

function raw(value: unknown): string {
  return String(value ?? "").trim();
}

function mask(value: string): string {
  if (isSerialLike(value)) {
    return value.replace(/[^a-z0-9]/gi, "").length === 10
      ? "AAA9999AAA:length=10"
      : `SERIAL:length=${value.replace(/[^a-z0-9]/gi, "").length}`;
  }
  if (/^\d+(\.\d+)?$/.test(value)) return "number";
  return `text:length=${Math.min(value.length, 99)}`;
}

function buildColumns(rows: unknown[][], headerRowIndex: number): SanitizedColumn[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: columnCount }, (_, index) => {
    const values = rows.slice(headerRowIndex + 1, headerRowIndex + 21)
      .map((row) => raw(row[index]))
      .filter(Boolean);
    return {
      index,
      header: raw(rows[headerRowIndex]?.[index]),
      nonEmptyCount: values.length,
      serialLikeCount: values.filter(isSerialLike).length,
      samples: [...new Set(values.map(mask))].slice(0, 3),
    };
  });
}

export function sanitizeWorkbookProfile(profile: WorkbookProfile): SanitizedProfile {
  return {
    sheets: profile.sheets.map((sheet) => {
      const candidateHeaderRows = sheet.rows.slice(0, 12)
        .map((row, rowIndex) => ({
          rowIndex,
          score: row.filter((value) => /\b(serial|service tag|device|model|product|sku|asset|cpu|processor|ram|memory|user|department|type|number|no)\b/i.test(raw(value))).length,
          columns: buildColumns(sheet.rows, rowIndex),
        }))
        .filter((candidate) => candidate.score >= 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(({ rowIndex, columns }) => ({ rowIndex, columns }));
      return {
        name: sheet.name,
        rowCount: sheet.rows.length,
        columnCount: Math.max(0, ...sheet.rows.map((row) => row.length)),
        candidateHeaderRows,
        columns: candidateHeaderRows[0]?.columns ?? [],
      };
    }),
  };
}

function validOptionalColumn(value: unknown, columnCount: number): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0 && Number(value) < columnCount);
}

export function validateSuggestedMappings(
  profile: WorkbookProfile,
  suggestions: SuggestedMapping[],
): ColumnMapping[] {
  return suggestions.map((suggestion) => {
    const sheet = profile.sheets.find((candidate) => candidate.name === suggestion.sheetName);
    const columnCount = sheet ? Math.max(0, ...sheet.rows.map((row) => row.length)) : 0;
    if (!sheet
      || !Number.isInteger(suggestion.headerRowIndex)
      || suggestion.headerRowIndex < 0
      || suggestion.headerRowIndex >= sheet.rows.length
      || !Number.isInteger(suggestion.serialColumnIndex)
      || suggestion.serialColumnIndex < 0
      || suggestion.serialColumnIndex >= columnCount
      || ![
        suggestion.modelColumnIndex,
        suggestion.productNumberColumnIndex,
        suggestion.deviceTypeColumnIndex,
        suggestion.assetColumnIndex,
      ].every((column) => validOptionalColumn(column, columnCount))) {
      throw new Error("Suggested mapping points outside the workbook.");
    }

    const values = sheet.rows.slice(suggestion.headerRowIndex + 1, suggestion.headerRowIndex + 31)
      .map((row) => row[suggestion.serialColumnIndex])
      .filter((value) => raw(value));
    const serialCount = values.filter(isSerialLike).length;
    if (!values.length || serialCount / values.length < 0.5) {
      throw new Error("Suggested serial column does not contain enough serial-like values.");
    }

    return {
      ...suggestion,
      role: raw(suggestion.role) || "Primary",
      confidence: 0.7,
      matchReason: "AI-assisted workbook mapping; user confirmation required",
    };
  });
}
