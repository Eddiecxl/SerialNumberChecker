declare module 'xlsx-populate/browser/xlsx-populate' {
  export interface Cell {
    columnNumber(): number;
    rowNumber(): number;
    style(name: string): unknown;
    style(properties: Record<string, unknown>): Cell;
    value(): unknown;
    value(value: unknown): Cell;
  }

  export interface Range {
    clear(): Range;
    startCell(): Cell;
    style(properties: Record<string, unknown>): Range;
    value(): unknown[][];
    value(value: unknown[][]): Range;
  }

  export interface Column {
    width(value: number): Column;
  }

  export interface Row {
    height(value: number): Row;
  }

  export interface Sheet {
    addSheet(name: string): Sheet;
    cell(address: string): Cell;
    cell(row: number, column: number): Cell;
    column(index: number): Column;
    freezePanes(columns: number, rows: number): Sheet;
    name(): string;
    range(startRow: number, startColumn: number, endRow: number, endColumn: number): Range;
    row(index: number): Row;
    usedRange(): Range | undefined;
  }

  export interface Workbook {
    addSheet(name: string): Sheet;
    outputAsync(): Promise<Blob | ArrayBuffer>;
    sheet(name: string): Sheet | undefined;
    sheets(): Sheet[];
  }

  interface XlsxPopulateStatic {
    fromDataAsync(data: ArrayBuffer): Promise<Workbook>;
  }

  const XlsxPopulate: XlsxPopulateStatic;
  export default XlsxPopulate;
}
