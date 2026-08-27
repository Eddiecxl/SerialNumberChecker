import assert from 'node:assert/strict';
import XlsxPopulate from 'xlsx-populate';

const normalizeKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value) => value === null || value === undefined ? '' : String(value).trim();
const serialHeaders = ['serialno', 'serialnumber', 'deviceserial', 'serial', 'servicetag', 'sn'];
const cpuHeaders = ['cpu', 'processor', 'processormodel', 'processorname', 'cpuspec', 'cpuspecification'];
const ramHeaders = ['ram', 'memory', 'systemmemory', 'installedmemory', 'memorysize', 'ramspec', 'ramspecification'];
const verifiedCpuHeaders = ['verifiedcpu', 'correctedcpu', 'hpcpu', 'lookedupcpu'];
const verifiedRamHeaders = ['verifiedram', 'correctedram', 'hpram', 'lookedupram'];
const reviewHeaders = ['reviewreason', 'lookupreason', 'verificationreason', 'specificationreview'];

function detect(sheet) {
  const usedRange = sheet.usedRange();
  const matrix = usedRange.value();
  const rangeStartRow = usedRange.startCell().rowNumber();
  const rangeStartColumn = usedRange.startCell().columnNumber();
  const headerIndex = matrix.slice(0, 20).findIndex((row) => row.some((cell) => serialHeaders.includes(normalizeKey(cell))));
  const headers = matrix[headerIndex].map(normalizeKey);
  const serialMatch = headers.findIndex((header) => serialHeaders.includes(header));
  const cpuMatch = headers.findIndex((header) => cpuHeaders.includes(header));
  const ramMatch = headers.findIndex((header) => ramHeaders.includes(header));
  const lastContentColumn = matrix.reduce((last, row) => {
    for (let column = row.length - 1; column >= 0; column -= 1) {
      if (text(row[column])) return Math.max(last, rangeStartColumn - 1 + column);
    }
    return last;
  }, rangeStartColumn + headers.length - 2);
  return {
    headerRow: rangeStartRow + headerIndex,
    serialColumn: rangeStartColumn - 1 + serialMatch,
    cpuColumn: cpuMatch >= 0 ? rangeStartColumn - 1 + cpuMatch : -1,
    ramColumn: ramMatch >= 0 ? rangeStartColumn - 1 + ramMatch : -1,
    lastContentColumn,
    rangeStartRow,
    headerIndex,
    rows: matrix.slice(headerIndex + 1).map((row, offset) => ({
      rowNumber: rangeStartRow + headerIndex + offset + 1,
      serial: text(row[serialMatch]),
      existingCpu: cpuMatch >= 0 ? text(row[cpuMatch]) : '',
      existingRam: ramMatch >= 0 ? text(row[ramMatch]) : '',
    })),
  };
}

function enrich(sheet, layout) {
  const usedRange = sheet.usedRange();
  const rangeStartRow = usedRange.startCell().rowNumber();
  const rangeStartColumn = usedRange.startCell().columnNumber();
  const headerValues = usedRange.value()[layout.headerRow - rangeStartRow];
  const normalizedHeaders = headerValues.map(normalizeKey);
  let nextColumn = Math.max(layout.lastContentColumn + 2, rangeStartColumn + headerValues.length);
  const findHeaderColumn = (aliases) => {
    const match = normalizedHeaders.findIndex((header) => aliases.includes(header));
    return match >= 0 ? rangeStartColumn + match : 0;
  };
  const ensureColumn = (aliases, label) => {
    const existing = findHeaderColumn(aliases);
    if (existing) return existing;
    const column = nextColumn++;
    sheet.cell(layout.headerRow, column).value(label);
    normalizedHeaders[column - rangeStartColumn] = normalizeKey(label);
    return column;
  };
  const cpuColumn = layout.cpuColumn >= 0 ? layout.cpuColumn + 1 : ensureColumn(cpuHeaders, 'CPU');
  const ramColumn = layout.ramColumn >= 0 ? layout.ramColumn + 1 : ensureColumn(ramHeaders, 'RAM');
  const verifiedCpuColumn = layout.rows.some((row) => row.existingCpu) ? ensureColumn(verifiedCpuHeaders, 'Verified CPU') : 0;
  const verifiedRamColumn = layout.rows.some((row) => row.existingRam) ? ensureColumn(verifiedRamHeaders, 'Verified RAM') : 0;
  const reviewColumn = ensureColumn(reviewHeaders, 'Review reason');
  layout.rows.forEach((row) => {
    sheet.cell(row.rowNumber, row.existingCpu ? verifiedCpuColumn : cpuColumn).value(`HP CPU ${row.serial}`);
    sheet.cell(row.rowNumber, row.existingRam ? verifiedRamColumn : ramColumn).value(`HP RAM ${row.serial}`);
    sheet.cell(row.rowNumber, reviewColumn).value(row.existingCpu || row.existingRam ? 'Existing values preserved.' : 'HP ambiguity review.');
  });
}

const workbook = await XlsxPopulate.fromBlankAsync();
const existing = workbook.sheet(0).name('Existing columns');
existing.cell('B3').value([
  ['Asset', 'Serial Number', 'Processor', 'Memory', 'Owner'],
  ['A-1', 'SN001', 'Old CPU', 'Old RAM', 'EC'],
  ['A-2', 'SN002', '', '', 'EC'],
]);
const missing = workbook.addSheet('Missing columns');
missing.cell('D5').value([
  ['Asset Tag', 'Service Tag', 'Description'],
  ['B-1', 'SN003', 'Desktop'],
]);

const existingLayout = detect(existing);
const missingLayout = detect(missing);
enrich(existing, existingLayout);
enrich(missing, missingLayout);
const reopened = await XlsxPopulate.fromDataAsync(await workbook.outputAsync());

assert.deepEqual(reopened.sheet('Existing columns').range('D3:I5').value(), [
  ['Processor', 'Memory', 'Owner', 'Verified CPU', 'Verified RAM', 'Review reason'],
  ['Old CPU', 'Old RAM', 'EC', 'HP CPU SN001', 'HP RAM SN001', 'Existing values preserved.'],
  ['HP CPU SN002', 'HP RAM SN002', 'EC', undefined, undefined, 'HP ambiguity review.'],
]);
assert.deepEqual(reopened.sheet('Missing columns').range('D5:I6').value(), [
  ['Asset Tag', 'Service Tag', 'Description', 'CPU', 'RAM', 'Review reason'],
  ['B-1', 'SN003', 'Desktop', 'HP CPU SN003', 'HP RAM SN003', 'HP ambiguity review.'],
]);
console.log('Flexible-column QA passed for offset headers, existing values, blank targets, and missing CPU/RAM columns.');
