import type { ExportCell } from "./results";

type ExportRow = Record<string, ExportCell>;

interface CellLike {
  hyperlink(value: string): CellLike;
  style(name: string): unknown;
  style(properties: Record<string, unknown>): CellLike;
  value(): unknown;
  value(value: unknown): CellLike;
}

interface RangeLike {
  autoFilter(): RangeLike;
  style(properties: Record<string, unknown>): RangeLike;
  value(value: unknown[][]): RangeLike;
}

interface SheetLike {
  cell(address: string): CellLike;
  cell(row: number, column: number): CellLike;
  column(index: number): { width(value: number): unknown };
  gridLinesVisible(value: boolean): SheetLike;
  range(startRow: number, startColumn: number, endRow: number, endColumn: number): RangeLike;
  row(index: number): { height(value: number): unknown };
  tabColor(value: string): SheetLike;
}

interface WorkbookLike {
  addSheet(name: string): SheetLike;
  sheet(name: string): SheetLike | undefined;
}

export interface ResultWorksheetData {
  primaryRows: ExportRow[];
  reviewRows: ExportRow[];
  evidenceRows: ExportRow[];
}

interface SheetDesign {
  baseName: string;
  title: string;
  description: string;
  rows: ExportRow[];
  fallbackHeaders: string[];
  tabColor: string;
  widths: Record<string, number>;
  wrapped: Set<string>;
}

const HEADER_ROW = 4;
const DATA_ROW = 5;

export const PRIMARY_HEADERS = [
  "Role", "SerialNumber", "SourceModel", "HPProductNumber", "HPProductName",
  "CPU", "RAM", "ValidationStatus", "Storage", "Graphics", "Display", "Battery",
  "Network", "Power", "Keyboard", "SystemBoard", "OperatingSystem", "ReviewReason",
  "SourceSheet", "SourceRow", "HPSource",
];

export const REVIEW_HEADERS = [
  "Role", "SerialNumber", "SourceModel", "HPProductNumber", "HPProductName", "CPU", "RAM",
  "ValidationStatus", "ReviewReason", "RecommendedAction", "CandidateProducts", "HPSource",
];

export const EVIDENCE_HEADERS = [
  "Role", "SerialNumber", "SourceSheet", "SourceRow", "SourceModel", "SourceProductNumber",
  "SourceAsset", "HPProductNumber", "HPProductName", "ValidationStatus", "ReviewReason",
  "MatchMethod", "CandidateCount", "CandidateProducts", "CPUDescriptionEvidence", "RAMDescriptionEvidence", "EvidencePartNumbers",
  "EvidenceDescriptions", "Optical", "Audio", "OtherSpecifications", "LookupCountry", "LookupTime",
  "HPSource",
];

const LABELS: Record<string, string> = {
  SerialNumber: "Serial Number",
  SourceModel: "Source Model",
  SourceProductNumber: "Source Product Number",
  SourceAsset: "Source Asset",
  HPProductNumber: "HP Product Number",
  HPProductName: "HP Product Name",
  ValidationStatus: "Validation Status",
  ReviewReason: "Review Reason",
  RecommendedAction: "Recommended Action",
  CandidateCount: "Candidate Count",
  CandidateProducts: "Candidate Products",
  CPUDescriptionEvidence: "CPU Description Evidence",
  RAMDescriptionEvidence: "RAM Description Evidence",
  EvidencePartNumbers: "Evidence Part Numbers",
  EvidenceDescriptions: "Evidence Descriptions",
  OtherSpecifications: "Other Specifications",
  SystemBoard: "System Board",
  OperatingSystem: "Operating System",
  SourceSheet: "Source Sheet",
  SourceRow: "Source Row",
  LookupCountry: "Lookup Country",
  LookupTime: "Lookup Time",
  HPSource: "HP Source",
};

function uniqueSheetName(workbook: WorkbookLike, baseName: string): string {
  if (!workbook.sheet(baseName)) return baseName;
  let suffix = 2;
  while (workbook.sheet(`${baseName} (${suffix})`)) suffix += 1;
  return `${baseName} (${suffix})`;
}

function summary(rows: ExportRow[]): Array<[string, string | number]> {
  const count = (status: string) => rows.filter((row) => row.ValidationStatus === status).length;
  return [
    ["Records", rows.length],
    ["Verified", count("VERIFIED")],
    ["Review required", count("REVIEW REQUIRED")],
    ["Unresolved", count("UNRESOLVED")],
  ];
}

function writeSheet(workbook: WorkbookLike, design: SheetDesign): string {
  const sheetName = uniqueSheetName(workbook, design.baseName);
  const sheet = workbook.addSheet(sheetName);
  const headers = design.rows.length ? Object.keys(design.rows[0]) : design.fallbackHeaders;
  const values = design.rows.map((row) => headers.map((header) => {
    const value = row[header];
    return value === "" || value === undefined ? undefined : value;
  }));
  const lastColumn = Math.max(headers.length, 1);
  const lastDataRow = DATA_ROW + Math.max(values.length - 1, 0);

  sheet.gridLinesVisible(false);
  sheet.tabColor(design.tabColor);
  sheet.cell("A1").value(design.title).style({
    bold: true, fontColor: "173D83", fontFamily: "Arial", fontSize: 16,
  });
  sheet.cell("A2").value(design.description).style({
    fontColor: "5B6B86", fontFamily: "Arial", fontSize: 10, italic: true,
  });
  summary(design.rows).forEach(([label, value], index) => {
    const column = Math.max(1, lastColumn - 7 + (index * 2));
    sheet.cell(2, column).value(label).style({ bold: true, fontColor: "5B6B86", fontFamily: "Arial", fontSize: 10 });
    sheet.cell(2, column + 1).value(value).style({ bold: true, fontColor: "173D83", fontFamily: "Arial", fontSize: 11 });
  });

  sheet.range(HEADER_ROW, 1, HEADER_ROW, lastColumn).value([headers.map((header) => LABELS[header] ?? header)]).style({
    bold: true, fontColor: "FFFFFF", fill: "173D83", fontFamily: "Arial", fontSize: 11,
    horizontalAlignment: "center", verticalAlignment: "center", wrapText: true,
    bottomBorder: true, bottomBorderColor: "0E2B5E",
  });
  sheet.row(1).height(26);
  sheet.row(2).height(22);
  sheet.row(HEADER_ROW).height(34);

  if (values.length) {
    sheet.range(DATA_ROW, 1, lastDataRow, lastColumn).value(values).style({
      fontColor: "24324A", fontFamily: "Arial", fontSize: 11,
      verticalAlignment: "top", bottomBorder: true, bottomBorderColor: "DDE4EE",
    });
    for (let row = DATA_ROW; row <= lastDataRow; row += 1) {
      if ((row - DATA_ROW) % 2 === 1) {
        sheet.range(row, 1, row, lastColumn).style({ fill: "F6F8FC" });
      }
    }
  }

  headers.forEach((header, index) => {
    const column = index + 1;
    sheet.column(column).width(design.widths[header] ?? 20);
    if (design.wrapped.has(header) && values.length) {
      sheet.range(DATA_ROW, column, lastDataRow, column).style({ wrapText: true });
    }
    if (header === "SerialNumber" && values.length) {
      sheet.range(DATA_ROW, column, lastDataRow, column).style({ bold: true, fontColor: "173D83" });
    }
    if (header === "ValidationStatus") {
      design.rows.forEach((row, rowIndex) => {
        const value = String(row.ValidationStatus ?? "");
        const colors = value === "VERIFIED"
          ? { fill: "E4F4ED", fontColor: "087A69" }
          : value === "UNRESOLVED"
            ? { fill: "FCE8E6", fontColor: "B54237" }
            : { fill: "FFF1D6", fontColor: "9A6200" };
        sheet.cell(DATA_ROW + rowIndex, column).style({ ...colors, bold: true, horizontalAlignment: "center" });
      });
    }
    if (header === "HPSource") {
      design.rows.forEach((row, rowIndex) => {
        const source = String(row.HPSource ?? "");
        if (!source) return;
        sheet.cell(DATA_ROW + rowIndex, column)
          .value("Open HP source")
          .hyperlink(source)
          .style({ fontColor: "1463D6", underline: true, bold: true });
      });
    }
  });

  sheet.range(HEADER_ROW, 1, Math.max(HEADER_ROW, lastDataRow), lastColumn).autoFilter();
  return sheetName;
}

export function writeResultWorksheets(workbook: WorkbookLike, data: ResultWorksheetData) {
  const primarySheetName = writeSheet(workbook, {
    baseName: "Spec Results",
    title: "Device specification results",
    description: "Business-ready HP specifications. CPU and RAM remain the primary verification fields.",
    rows: data.primaryRows,
    fallbackHeaders: PRIMARY_HEADERS,
    tabColor: "173D83",
    widths: {
      Role: 10, SerialNumber: 18, SourceModel: 27, HPProductNumber: 19, HPProductName: 34,
      CPU: 34, RAM: 30, ValidationStatus: 20, Storage: 32, Graphics: 28, Display: 30,
      Battery: 27, Network: 30, Power: 27, Keyboard: 28, SystemBoard: 30,
      OperatingSystem: 28, ReviewReason: 46, SourceSheet: 20, SourceRow: 12, HPSource: 18,
    },
    wrapped: new Set(["SourceModel", "HPProductName", "CPU", "RAM", "Storage", "Graphics", "Display", "Battery", "Network", "Power", "Keyboard", "SystemBoard", "OperatingSystem", "ReviewReason"]),
  });
  const reviewSheetName = writeSheet(workbook, {
    baseName: "Review Required",
    title: "Devices requiring review",
    description: "Action list for ambiguous or unresolved records. Validate these rows before customer use.",
    rows: data.reviewRows,
    fallbackHeaders: REVIEW_HEADERS,
    tabColor: "D89020",
    widths: {
      Role: 10, SerialNumber: 18, SourceModel: 28, HPProductNumber: 19, HPProductName: 34,
      CPU: 32, RAM: 30, ValidationStatus: 20, ReviewReason: 48, RecommendedAction: 52,
      CandidateProducts: 48, HPSource: 18,
    },
    wrapped: new Set(["SourceModel", "HPProductName", "CPU", "RAM", "ReviewReason", "RecommendedAction", "CandidateProducts"]),
  });
  const evidenceSheetName = writeSheet(workbook, {
    baseName: "Evidence Detail",
    title: "HP lookup evidence detail",
    description: "Audit trail containing source identifiers, candidate products, BOM evidence, lookup metadata and HP links.",
    rows: data.evidenceRows,
    fallbackHeaders: EVIDENCE_HEADERS,
    tabColor: "5B6B86",
    widths: {
      Role: 10, SerialNumber: 18, SourceSheet: 20, SourceRow: 12, SourceModel: 28,
      SourceProductNumber: 20, SourceAsset: 18, HPProductNumber: 19, HPProductName: 34,
      ValidationStatus: 20, ReviewReason: 48, MatchMethod: 19, CandidateCount: 14, CandidateProducts: 48, CPUDescriptionEvidence: 48,
      RAMDescriptionEvidence: 48, EvidencePartNumbers: 40, EvidenceDescriptions: 56,
      Optical: 30, Audio: 30, OtherSpecifications: 48, LookupCountry: 17, LookupTime: 24, HPSource: 18,
    },
    wrapped: new Set(["SourceModel", "HPProductName", "ReviewReason", "CandidateProducts", "CPUDescriptionEvidence", "RAMDescriptionEvidence", "EvidencePartNumbers", "EvidenceDescriptions", "Optical", "Audio", "OtherSpecifications"]),
  });

  return { primarySheetName, reviewSheetName, evidenceSheetName };
}
