export type CellValue = string | number | boolean | Date | null | undefined;

export interface MergedRangeProfile {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface WorksheetProfile {
  name: string;
  rows: CellValue[][];
  mergedRanges?: MergedRangeProfile[];
}

export interface WorkbookProfile {
  sheets: WorksheetProfile[];
}

export interface ColumnMapping {
  sheetName: string;
  headerRowIndex: number;
  serialColumnIndex: number;
  role: string;
  modelColumnIndex?: number;
  productNumberColumnIndex?: number;
  deviceTypeColumnIndex?: number;
  assetColumnIndex?: number;
  usernameColumnIndex?: number;
  departmentColumnIndex?: number;
  cpuColumnIndex?: number;
  ramColumnIndex?: number;
  confidence: number;
  matchReason: string;
}

export interface LayoutAnalysis {
  mappings: ColumnMapping[];
  needsConfirmation: boolean;
  warnings: string[];
}

export interface SourceCell {
  sheetName: string;
  rowIndex: number;
  columnIndex: number;
}

export interface DeviceRecord {
  id: string;
  serialNumber: string;
  normalizedSerial: string;
  role: string;
  sourceSheet: string;
  sourceRow: number;
  serialColumn: number;
  sourceGroupKey: string;
  modelHint?: string;
  productNumberHint?: string;
  deviceTypeHint?: string;
  assetHint?: string;
  usernameHint?: string;
  departmentHint?: string;
}
