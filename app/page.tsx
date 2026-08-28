'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell as XlsxCell } from 'xlsx-populate/browser/xlsx-populate';
import {
  createEmptyMoreInfo, defaultHardwareFields, hardwareFieldDefinitions,
  type DeviceMoreInfo, type HardwareFieldKey,
} from './lib/device-fields';

type RowStatus = 'ready' | 'looking' | 'found' | 'inferred' | 'review' | 'skipped' | 'error';
type ActiveView = 'specs' | 'more' | 'validation' | 'fields' | 'data' | 'settings';
type ValidationStatus = 'supported' | 'review' | 'unavailable' | 'pending';
type ValidationCheck = { key: string; label: string; status: 'pass' | 'review'; detail: string };

type SheetRecord = {
  id: string;
  rowNumber: number;
  headerRow: number;
  sheetName: string;
  number: string;
  serialNumber: string;
  asset: string;
  description: string;
  existingCpu: string;
  existingRam: string;
  cpuColumn: number;
  ramColumn: number;
  serialColumn: number;
  lastContentColumn: number;
  cpu: string;
  ram: string;
  productName: string;
  productNumber: string;
  cpuSource: string;
  ramSource: string;
  cpuEvidence: string[];
  ramEvidence: string[];
  validationStatus: ValidationStatus;
  validationChecks: ValidationCheck[];
  validationSummary: string;
  parserVersion: string;
  manuallyReviewed: boolean;
  reviewReason: string;
  sourceUrl: string;
  lookupCountry: string;
  lookedUpAt: string;
  unitConfigurationCount: number;
  moreInfo: DeviceMoreInfo;
  status: RowStatus;
  error?: string;
};

type HpResponse = {
  cpu: string;
  ram: string;
  cpuSource: string;
  ramSource: string;
  cpuEvidence: string[];
  ramEvidence: string[];
  validationStatus: Exclude<ValidationStatus, 'pending'>;
  validationChecks: ValidationCheck[];
  validationSummary: string;
  parserVersion: string;
  productName: string;
  productNumber: string;
  found: boolean;
  ramCandidates?: string[];
  reviewReason?: string;
  sourceUrl: string;
  moreInfo: DeviceMoreInfo;
  lookupCountry: string;
  lookedUpAt: string;
  unitConfigurationCount: number;
  error?: string;
};

type RunSummary = {
  uniqueLookups: number;
  duplicateRows: number;
  retries: number;
  finishedAt: string;
};

const serialHeaders = ['serialno', 'serialnumber', 'deviceserial', 'deviceserialnumber', 'serial', 'servicetag', 'sn', 'serialid'];
const cpuHeaders = ['cpu', 'processor', 'processormodel', 'processorname', 'cpuspec', 'cpuspecification'];
const ramHeaders = ['ram', 'memory', 'systemmemory', 'installedmemory', 'memorysize', 'ramspec', 'ramspecification'];
const verifiedCpuHeaders = ['verifiedcpu', 'correctedcpu', 'hpcpu', 'lookedupcpu'];
const verifiedRamHeaders = ['verifiedram', 'correctedram', 'hpram', 'lookedupram'];
const reviewHeaders = ['reviewreason', 'lookupreason', 'verificationreason', 'specificationreview'];
const normalizeKey = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value: unknown) => value === null || value === undefined ? '' : String(value).trim();

function statusLabel(status: RowStatus) {
  return {
    ready: 'Ready', looking: 'Looking up', found: 'Exact BOM', inferred: 'RAM inferred',
    review: 'Review', skipped: 'Not applicable', error: 'Error',
  }[status];
}

function validationLabel(status: ValidationStatus) {
  return { supported: 'Evidence supported', review: 'Review required', unavailable: 'Unavailable', pending: 'Pending lookup' }[status];
}

const infoText = (values: string[]) => values.length ? values.join(' · ') : 'Not listed by HP';
const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export default function Home() {
  const [records, setRecords] = useState<SheetRecord[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>('specs');
  const [fileName, setFileName] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete' | 'review'>('all');
  const [selectedFields, setSelectedFields] = useState<HardwareFieldKey[]>(defaultHardwareFields);
  const [runSummary, setRunSummary] = useState<RunSummary>({ uniqueLookups: 0, duplicateRows: 0, retries: 0, finishedAt: '' });
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState('');
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const originalBuffer = useRef<ArrayBuffer | null>(null);
  const stopRequested = useRef(false);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  };

  const loadWorkbook = async (buffer: ArrayBuffer, name: string) => {
    setLoadingFile(true);
    try {
      const { default: XlsxPopulate } = await import('xlsx-populate/browser/xlsx-populate');
      const workbook = await XlsxPopulate.fromDataAsync(buffer.slice(0));
      const found: SheetRecord[] = [];
      for (const sheet of workbook.sheets()) {
        const usedRange = sheet.usedRange();
        if (!usedRange) continue;
        const matrix = usedRange.value();
        if (!Array.isArray(matrix)) continue;
        const rangeStartRow = usedRange.startCell().rowNumber();
        const rangeStartColumn = usedRange.startCell().columnNumber();
        const headerIndex = matrix.slice(0, 40).findIndex((row: unknown[]) =>
          Array.isArray(row) && row.some((cell) => serialHeaders.includes(normalizeKey(cell))),
        );
        if (headerIndex < 0) continue;
        const headers = matrix[headerIndex].map(normalizeKey);
        const serialMatch = headers.findIndex((header: string) => serialHeaders.includes(header));
        const cpuMatch = headers.findIndex((header: string) => cpuHeaders.includes(header));
        const ramMatch = headers.findIndex((header: string) => ramHeaders.includes(header));
        const serialColumn = rangeStartColumn - 1 + serialMatch;
        const cpuColumn = cpuMatch >= 0 ? rangeStartColumn - 1 + cpuMatch : -1;
        const ramColumn = ramMatch >= 0 ? rangeStartColumn - 1 + ramMatch : -1;
        const lastContentColumn = matrix.reduce((last: number, row: unknown[]) => {
          if (!Array.isArray(row)) return last;
          for (let column = row.length - 1; column >= 0; column -= 1) {
            if (text(row[column])) return Math.max(last, rangeStartColumn - 1 + column);
          }
          return last;
        }, Math.max(rangeStartColumn + headers.length - 2, serialColumn));
        const numberColumn = headers.findIndex((header: string) => header === 'no' || header === 'number');
        const assetColumn = headers.findIndex((header: string) => header === 'asset' || header === 'assest');
        const descriptionColumn = headers.findIndex((header: string) => header === 'assetdescription' || header === 'assestdescription' || header === 'description');
        matrix.slice(headerIndex + 1).forEach((row: unknown[], rowOffset: number) => {
          const serialNumber = text(row[serialMatch]).toUpperCase();
          if (!serialNumber) return;
          const description = descriptionColumn >= 0 ? text(row[descriptionColumn]) : '';
          found.push({
            id: `${sheet.name()}:${rangeStartRow + headerIndex + rowOffset + 1}`,
            rowNumber: rangeStartRow + headerIndex + rowOffset + 1,
            headerRow: rangeStartRow + headerIndex,
            sheetName: sheet.name(),
            number: numberColumn >= 0 ? text(row[numberColumn]) : String(rowOffset + 1),
            serialNumber,
            asset: assetColumn >= 0 ? text(row[assetColumn]) : '',
            description,
            existingCpu: cpuMatch >= 0 ? text(row[cpuMatch]) : '',
            existingRam: ramMatch >= 0 ? text(row[ramMatch]) : '',
            cpuColumn, ramColumn, serialColumn, lastContentColumn,
            cpu: '', ram: '', productName: '', productNumber: '', cpuSource: '', ramSource: '',
            cpuEvidence: [], ramEvidence: [], validationStatus: 'pending', validationChecks: [],
            validationSummary: '', parserVersion: '', manuallyReviewed: false,
            reviewReason: '', sourceUrl: '', lookupCountry: '', lookedUpAt: '', unitConfigurationCount: 0,
            moreInfo: createEmptyMoreInfo(),
            status: /monitor|display/i.test(description) ? 'skipped' : 'ready',
          });
        });
      }
      if (!found.length) throw new Error('No Serial No column was found');
      originalBuffer.current = buffer.slice(0);
      setRecords(found);
      setFileName(name);
      setProcessed(0);
      setRunSummary({ uniqueLookups: 0, duplicateRows: 0, retries: 0, finishedAt: '' });
      notify(`${found.length} serial numbers detected`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to read this workbook');
    } finally {
      setLoadingFile(false);
    }
  };

  useEffect(() => {
    fetch('/data/workbook-manifest.json')
      .then((response) => response.ok
        ? response.json() as Promise<{ name: string; url: string } | null>
        : null)
      .then(async (manifest: { name: string; url: string } | null) => {
        if (!manifest?.url) return;
        const response = await fetch(manifest.url);
        if (!response.ok) return;
        await loadWorkbook(await response.arrayBuffer(), manifest.name);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!detailRecordId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailRecordId(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailRecordId]);

  const importExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await loadWorkbook(await file.arrayBuffer(), file.name);
    event.target.value = '';
  };

  const dropExcel = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith('.xlsx')) {
      notify('Please drop an .xlsx workbook'); return;
    }
    await loadWorkbook(await file.arrayBuffer(), file.name);
  };

  const updateRecord = (id: string, patch: Partial<SheetRecord>) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
  };

  const runLookup = async () => {
    if (!records.length || running) return;
    stopRequested.current = false;
    setRunning(true); setProcessed(0);
    const queue = records.filter((record) => record.status !== 'skipped');
    const uniqueSerials = new Set(queue.map((record) => record.serialNumber));
    const lookupCache = new Map<string, Promise<HpResponse>>();
    let retryCount = 0;
    const fetchWithRetry = async (serialNumber: string) => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetch('/api/hp-lookup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serial: serialNumber }),
          });
          const data = await response.json() as HpResponse;
          if (response.ok) return data;
          if ((response.status === 429 || response.status >= 500) && attempt < 3) {
            retryCount += 1;
            await delay(450 * attempt);
            continue;
          }
          throw new Error(data.error || 'Lookup failed');
        } catch (error) {
          if (attempt < 3 && error instanceof TypeError) {
            retryCount += 1;
            await delay(450 * attempt);
            continue;
          }
          throw error;
        }
      }
      throw new Error('Lookup failed after three attempts');
    };
    const lookupSerial = (serialNumber: string) => {
      const cached = lookupCache.get(serialNumber);
      if (cached) return cached;
      const request = fetchWithRetry(serialNumber);
      lookupCache.set(serialNumber, request);
      return request;
    };
    let cursor = 0;
    const worker = async () => {
      while (!stopRequested.current) {
        const target = queue[cursor++];
        if (!target) break;
        updateRecord(target.id, { status: 'looking', error: '' });
        try {
          const data = await lookupSerial(target.serialNumber);
          const status: RowStatus = !data.found || data.cpuSource === 'not-listed' || ['spare-bom-review', 'not-listed'].includes(data.ramSource)
            ? 'review' : data.ramSource === 'spare-bom' ? 'inferred' : 'found';
          updateRecord(target.id, {
            cpu: data.cpu, ram: data.ram, cpuSource: data.cpuSource, ramSource: data.ramSource,
            cpuEvidence: data.cpuEvidence ?? [], ramEvidence: data.ramEvidence ?? [],
            validationStatus: data.validationStatus, validationChecks: data.validationChecks ?? [],
            validationSummary: data.validationSummary, parserVersion: data.parserVersion, manuallyReviewed: false,
            productName: data.productName, productNumber: data.productNumber, status,
            reviewReason: data.reviewReason ?? '', sourceUrl: data.sourceUrl,
            lookupCountry: data.lookupCountry, lookedUpAt: data.lookedUpAt,
            unitConfigurationCount: data.unitConfigurationCount,
            moreInfo: data.moreInfo ?? createEmptyMoreInfo(), error: '',
          });
        } catch (error) {
          updateRecord(target.id, { status: 'error', error: error instanceof Error ? error.message : 'Lookup failed' });
        } finally {
          setProcessed((value) => value + 1);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunSummary({
      uniqueLookups: lookupCache.size,
      duplicateRows: Math.max(0, queue.length - uniqueSerials.size),
      retries: retryCount,
      finishedAt: new Date().toISOString(),
    });
    setRunning(false);
    notify(stopRequested.current ? 'Lookup paused' : 'HP lookup completed');
  };

  const stopLookup = () => { stopRequested.current = true; };

  const exportWorkbook = async (includeMoreInfo = false) => {
    if (!originalBuffer.current) return;
    const enriched = records.filter((record) => record.cpu || record.ram);
    if (!enriched.length) { notify('Run the HP lookup first'); return; }
    try {
      const { default: XlsxPopulate } = await import('xlsx-populate/browser/xlsx-populate');
      const workbook = await XlsxPopulate.fromDataAsync(originalBuffer.current.slice(0));
      const styleNames = ['fill', 'fontColor', 'bold', 'italic', 'fontSize', 'fontFamily', 'horizontalAlignment', 'verticalAlignment', 'wrapText', 'numberFormat', 'border'];
      const copyStyle = (source: XlsxCell, target: XlsxCell) => {
        const style: Record<string, unknown> = {};
        styleNames.forEach((name) => {
          const value = source.style(name);
          if (value !== undefined && value !== null) style[name] = value;
        });
        target.style(style);
      };
      const rowsBySheet = new Map<string, SheetRecord[]>();
      enriched.forEach((record) => rowsBySheet.set(record.sheetName, [...(rowsBySheet.get(record.sheetName) ?? []), record]));

      rowsBySheet.forEach((sheetRecords, sheetName) => {
        const sheet = workbook.sheet(sheetName);
        if (!sheet) return;
        const sample = sheetRecords[0];
        const usedRange = sheet.usedRange();
        if (!usedRange) return;
        const rangeStartRow = usedRange.startCell().rowNumber();
        const rangeStartColumn = usedRange.startCell().columnNumber();
        const headerValues = (usedRange.value()?.[sample.headerRow - rangeStartRow] ?? []) as unknown[];
        const normalizedHeaders = headerValues.map(normalizeKey);
        let nextColumn = Math.max(sample.lastContentColumn + 2, rangeStartColumn + headerValues.length);
        const headerTemplateColumn = sample.serialColumn + 1;
        const findHeaderColumn = (aliases: string[]) => {
          const match = normalizedHeaders.findIndex((header: string) => aliases.includes(header));
          return match >= 0 ? rangeStartColumn + match : 0;
        };
        const ensureColumn = (aliases: string[], label: string) => {
          const existingColumn = findHeaderColumn(aliases);
          if (existingColumn > 0) return existingColumn;
          const column = nextColumn++;
          const headerCell = sheet.cell(sample.headerRow, column);
          headerCell.value(label);
          copyStyle(sheet.cell(sample.headerRow, headerTemplateColumn), headerCell);
          sheetRecords.forEach((record) => copyStyle(sheet.cell(record.rowNumber, headerTemplateColumn), sheet.cell(record.rowNumber, column)));
          normalizedHeaders[column - rangeStartColumn] = normalizeKey(label);
          return column;
        };

        const cpuColumn = sample.cpuColumn >= 0 ? sample.cpuColumn + 1 : ensureColumn(cpuHeaders, 'CPU');
        const ramColumn = sample.ramColumn >= 0 ? sample.ramColumn + 1 : ensureColumn(ramHeaders, 'RAM');
        const needsVerifiedCpu = sheetRecords.some((record) => Boolean(record.existingCpu && record.cpu));
        const needsVerifiedRam = sheetRecords.some((record) => Boolean(record.existingRam && record.ram));
        const needsReview = sheetRecords.some((record) => Boolean(record.reviewReason || record.existingCpu || record.existingRam));
        const verifiedCpuColumn = needsVerifiedCpu ? ensureColumn(verifiedCpuHeaders, 'Verified CPU') : 0;
        const verifiedRamColumn = needsVerifiedRam ? ensureColumn(verifiedRamHeaders, 'Verified RAM') : 0;
        const reviewColumn = needsReview ? ensureColumn(reviewHeaders, 'Review reason') : 0;

        sheetRecords.forEach((record) => {
          if (record.cpu) sheet.cell(record.rowNumber, record.existingCpu ? verifiedCpuColumn : cpuColumn).value(record.cpu);
          if (record.ram) sheet.cell(record.rowNumber, record.existingRam ? verifiedRamColumn : ramColumn).value(record.ram);
          if (reviewColumn) {
            const reasons = [record.reviewReason];
            if (record.existingCpu) reasons.push('Existing CPU preserved; HP lookup result is in Verified CPU.');
            if (record.existingRam) reasons.push('Existing RAM preserved; HP lookup result is in Verified RAM.');
            sheet.cell(record.rowNumber, reviewColumn).value(reasons.filter(Boolean).join(' '));
          }
        });
      });
      if (includeMoreInfo) {
        const sheetName = 'More Device Info';
        let infoSheet = workbook.sheet(sheetName);
        if (!infoSheet) infoSheet = workbook.addSheet(sheetName);
        else infoSheet.usedRange()?.clear();
        const exportFields = hardwareFieldDefinitions.filter(({ key }) => selectedFields.includes(key));
        const headers = [
          'No.', 'Serial no', 'Product number', 'Product name', 'Asset description', 'CPU', 'RAM',
          'Confidence', 'CPU classification', 'RAM classification', 'CPU raw HP evidence', 'RAM raw HP evidence',
          'Automated validation', 'Validation checks', 'Manual review', 'Parser version',
          ...exportFields.map(({ exportLabel }) => exportLabel),
          'Build ID', 'Feature byte', 'MAC address', 'Manufacture date', 'UUID', 'RoHS status',
          'Serial configuration item count', 'Installed configuration items', 'Compatible spare-parts count',
          'Review reason', 'Lookup country', 'Lookup time', 'HP PartSurfer page',
        ];
        const rows = records.map((record) => {
          const info = record.moreInfo;
          const join = (values: string[]) => values.join(' | ');
          return [
            record.number, record.serialNumber, record.productNumber, record.productName || record.description,
            record.description, record.cpu, record.ram, statusLabel(record.status), record.cpuSource, record.ramSource,
            join(record.cpuEvidence), join(record.ramEvidence), record.validationSummary,
            record.validationChecks.map((check) => `${check.status.toUpperCase()}: ${check.label} — ${check.detail}`).join(' | '),
            record.manuallyReviewed ? 'Checked by user in Serial Spec' : 'Not checked', record.parserVersion,
            ...exportFields.map(({ key }) => join(info[key])),
            info.buildId, info.featureByte, info.macAddress, info.manufactureDate, info.uuid, info.rohsStatus,
            record.unitConfigurationCount || '',
            info.configurationItems.map((item) => `${item.partNumber}: ${item.description}${item.quantity ? ` × ${item.quantity}` : ''}`).join(' | '),
            info.sparePartCount || '', record.reviewReason, record.lookupCountry,
            record.lookedUpAt ? new Date(record.lookedUpAt).toLocaleString('en-MY') : '', record.sourceUrl,
          ];
        });
        infoSheet.cell('A1').value([headers, ...rows]);
        infoSheet.range(1, 1, 1, headers.length).style({
          bold: true, fontColor: 'FFFFFF', fill: '173D83', verticalAlignment: 'center', wrapText: true,
        });
        infoSheet.range(2, 1, rows.length + 1, headers.length).style({
          verticalAlignment: 'top', wrapText: true, fontSize: 9,
        });
        headers.forEach((header, index) => {
          const width = header === 'Installed configuration items' ? 60
            : header === 'Review reason' || header === 'HP PartSurfer page' || header.includes('raw HP evidence') || header === 'Validation checks' ? 44
              : ['No.', 'Confidence', 'CPU evidence', 'RAM evidence'].includes(header) ? 14 : 24;
          infoSheet.column(index + 1).width(width);
        });
        infoSheet.row(1).height(32);
        infoSheet.freezePanes(1, 2);
      }
      const output = await workbook.outputAsync();
      const blob = output instanceof Blob ? output : new Blob([output]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${fileName.replace(/\.xlsx$/i, '')}${includeMoreInfo ? ' - full device info' : ' - enriched'}.xlsx`;
      anchor.click(); URL.revokeObjectURL(url);
      notify(includeMoreInfo ? `Exported ${records.length} rows with more device information` : `Exported ${enriched.length} enriched rows`);
    } catch { notify('The enriched workbook could not be exported'); }
  };

  const copyResults = async () => {
    const rows = records.filter((record) => record.cpu || record.ram);
    if (!rows.length) { notify('No lookup results to copy yet'); return; }
    await navigator.clipboard.writeText([
      ['Serial no', 'CPU', 'RAM'].join('\t'),
      ...rows.map((record) => [record.serialNumber, record.cpu, record.ram].join('\t')),
    ].join('\n'));
    notify(`${rows.length} rows copied for Excel`);
  };

  const filtered = useMemo(() => records.filter((record) => {
    const info = record.moreInfo;
    const componentText = info.configurationItems.map((item) => `${item.partNumber} ${item.description}`).join(' ');
    const evidenceText = [...record.cpuEvidence, ...record.ramEvidence, ...record.validationChecks.map((check) => `${check.label} ${check.detail}`)].join(' ');
    const matchesQuery = `${record.serialNumber} ${record.description} ${record.productName} ${record.productNumber} ${record.cpu} ${record.ram} ${evidenceText} ${Object.values(info).flat().join(' ')} ${componentText}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || (activeView === 'validation'
      ? (filter === 'complete' && record.validationStatus === 'supported') || (filter === 'review' && ['review', 'unavailable'].includes(record.validationStatus))
      : (filter === 'complete' && ['found', 'inferred'].includes(record.status)) || (filter === 'review' && ['review', 'error'].includes(record.status)));
    return matchesQuery && matchesFilter;
  }), [records, query, filter, activeView]);

  const searchable = records.filter((record) => record.status !== 'skipped').length;
  const exactCount = records.filter((record) => record.status === 'found').length;
  const inferredCount = records.filter((record) => record.status === 'inferred').length;
  const completed = records.filter((record) => ['found', 'inferred'].includes(record.status)).length;
  const reviewCount = records.filter((record) => ['review', 'error'].includes(record.status)).length;
  const evidenceSupported = records.filter((record) => record.validationStatus === 'supported').length;
  const evidenceReview = records.filter((record) => record.validationStatus === 'review' || record.validationStatus === 'unavailable').length;
  const manuallyReviewed = records.filter((record) => record.manuallyReviewed).length;
  const progress = searchable ? Math.min(100, Math.round((processed / searchable) * 100)) : 0;
  const sourceMappings = useMemo(() => [...new Map(records.map((record) => [record.sheetName, record])).values()], [records]);
  const duplicateCount = records.length - new Set(records.map((record) => record.serialNumber)).size;
  const selectedFieldDefinitions = hardwareFieldDefinitions.filter(({ key }) => selectedFields.includes(key));
  const detailRecord = detailRecordId ? records.find((record) => record.id === detailRecordId) ?? null : null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><img src="/ctc-logo.png" alt="CTC — Challenging Tomorrow's Changes" /></div>
        <nav aria-label="Main navigation">
          <button className={`nav-icon ${activeView === 'specs' ? 'active' : ''}`} aria-current={activeView === 'specs' ? 'page' : undefined} onClick={() => setActiveView('specs')}><span className="nav-glyph">▦</span><small>CPU & RAM</small></button>
          <button className={`nav-icon ${activeView === 'more' ? 'active' : ''}`} aria-current={activeView === 'more' ? 'page' : undefined} onClick={() => setActiveView('more')}><span className="nav-glyph">≡</span><small>More info</small></button>
          <button className={`nav-icon ${activeView === 'validation' ? 'active' : ''}`} aria-current={activeView === 'validation' ? 'page' : undefined} onClick={() => setActiveView('validation')}><span className="nav-glyph">✓</span><small>Validation</small></button>
          <button className={`nav-icon ${activeView === 'fields' ? 'active' : ''}`} aria-current={activeView === 'fields' ? 'page' : undefined} onClick={() => setActiveView('fields')}><span className="nav-glyph">☷</span><small>Fields</small></button>
          <button className={`nav-icon ${activeView === 'data' ? 'active' : ''}`} aria-current={activeView === 'data' ? 'page' : undefined} onClick={() => setActiveView('data')}><span className="nav-glyph">↥</span><small>Source file</small></button>
        </nav>
        <button className={`nav-icon sidebar-bottom ${activeView === 'settings' ? 'active' : ''}`} aria-current={activeView === 'settings' ? 'page' : undefined} onClick={() => setActiveView('settings')}><span className="nav-glyph">⚙</span><small>Guide</small></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="product-lockup">
            <img src="/ctc-logo.png" alt="CTC — Challenging Tomorrow's Changes" />
            <span className="lockup-divider" />
            <div><p className="eyebrow">Device Intelligence</p><h1>Serial Spec</h1></div>
          </div>
          <div className="header-actions">
            <div className="region-pill">HP region · Malaysia</div>
            <div className="sync-pill"><span className="pulse-dot" />{fileName || 'Waiting for workbook'}</div>
            <button className="import-button" onClick={() => fileInput.current?.click()}>Import Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx" onChange={importExcel} hidden />
          </div>
        </header>

        <div className="batch-content">
          <section className="batch-hero">
            <div className="batch-copy">
              <span className="section-kicker"><span />{activeView === 'more' ? 'DEVICE DETAILS' : activeView === 'validation' ? 'EVIDENCE & VALIDATION' : activeView === 'fields' ? 'FIELD CONFIGURATION' : activeView === 'data' ? 'DATA SOURCE' : activeView === 'settings' ? 'WORKFLOW GUIDE' : 'BULK ENRICHMENT'}</span>
              {activeView === 'more' ? <><h2>See the device<br /><em>beyond CPU and RAM.</em></h2><p>The same HP lookup also collects product identity, storage, operating system, power, system board, identifiers, compliance and every serial-specific configuration line HP provides.</p></>
                : activeView === 'validation' ? <><h2>Every result needs<br /><em>visible supporting evidence.</em></h2><p>Compare the app’s CPU and RAM output with the exact raw HP lines used by the parser. Automated checks support review, but never replace physical verification for customer-critical delivery.</p></>
                : activeView === 'fields' ? <><h2>Choose the details<br /><em>your business needs.</em></h2><p>CPU, RAM and lookup evidence are always included. Select the additional HP component groups shown on screen and added to the full-information export.</p></>
                : activeView === 'data' ? <><h2>Your workbook,<br /><em>detected automatically.</em></h2><p>Place one .xlsx workbook in Base files or replace it here. Serial Spec detects the serial-number heading without changing your source file.</p></>
                : activeView === 'settings' ? <><h2>A safer path<br /><em>from lookup to export.</em></h2><p>Exact serial data stays separate from inferred compatible parts, and every unresolved result carries a visible review reason.</p></>
                : <><h2>From serial numbers<br />to <em>ready-to-use specs.</em></h2><p>Load any Excel layout. Serial Spec locates the serial, CPU and RAM headings, fills safe blank cells, and preserves existing values for review.</p></>}
            </div>
            <div className={`file-card ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={dropExcel}>
              {records.length ? (
                <>
                  <div className="file-badge">XLSX</div>
                  <div className="file-details"><span>WORKBOOK READY</span><strong>{fileName}</strong><small>{records.length} serial numbers · {searchable} device lookups</small></div>
                  <button onClick={() => fileInput.current?.click()}>Replace</button>
                </>
              ) : (
                <button className="empty-file" onClick={() => fileInput.current?.click()}>
                  <span className="upload-symbol">↥</span>
                  <strong>{loadingFile ? 'Reading workbook…' : 'Drop your Excel file here'}</strong>
                  <small>or choose an .xlsx file</small>
                </button>
              )}
            </div>
          </section>

          {records.length > 0 && <section className="workflow-strip" aria-label="Lookup workflow">
            <div><span>1</span><p><strong>Detect</strong>Workbook columns and eligible serials</p></div>
            <i />
            <div><span>2</span><p><strong>Lookup</strong>Malaysia HP PartSurfer data</p></div>
            <i />
            <div><span>3</span><p><strong>Review</strong>Exact, inferred and unresolved results</p></div>
            <i />
            <div><span>4</span><p><strong>Export</strong>Original layout plus verified evidence</p></div>
          </section>}

          {records.length > 0 && (activeView === 'specs' || activeView === 'more' || activeView === 'validation') && (
            <>
              <section className="control-deck">
                <div className="action-buttons">
                  {!running ? <button className="primary-action" onClick={runLookup}><span>▶</span>{processed ? 'Run lookup again' : 'Start HP lookup'}</button>
                    : <button className="stop-action" onClick={stopLookup}><span>■</span>Pause lookup</button>}
                  {activeView === 'specs' && <button className="secondary-action" onClick={copyResults}>Copy CPU & RAM</button>}
                  <button className="export-action" onClick={() => exportWorkbook(activeView !== 'specs')} disabled={!completed && !reviewCount}>
                    {activeView === 'validation' ? 'Export validation report' : activeView === 'more' ? 'Export more info' : 'Export enriched Excel'} <span>↓</span>
                  </button>
                </div>
                <div className="progress-block">
                  <div><span>{running ? 'HP lookup in progress' : processed ? 'Latest lookup progress' : 'Ready to begin'}</span><strong>{progress}%</strong></div>
                  <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
                  <small>{processed} of {searchable} eligible rows processed{runSummary.finishedAt ? ` · ${runSummary.uniqueLookups} unique HP requests · ${runSummary.duplicateRows} duplicates reused · ${runSummary.retries} retries` : ''}</small>
                </div>
              </section>

              <section className="stat-grid">
                <div><span className="stat-icon blue">#</span><p>Total serial numbers<strong>{records.length}</strong></p></div>
                <div><span className="stat-icon mint">✓</span><p>Exact serial BOM<strong>{exactCount}</strong></p></div>
                <div><span className="stat-icon blue">≈</span><p>RAM inferred<strong>{inferredCount}</strong></p></div>
                <div><span className="stat-icon amber">!</span><p>Needs review<strong>{reviewCount}</strong></p></div>
              </section>

              {activeView === 'specs' && <>
                <div className="export-note"><span>i</span><p><strong>Flexible export</strong> Serial Spec detects CPU and RAM columns wherever they appear. Blank cells are filled directly; existing values remain untouched and HP results plus review reasons are added in safe columns to the right.</p></div>
                <section className="results-card">
                <div className="results-toolbar">
                  <div><span className="section-kicker"><span />DEVICE REGISTER</span><h3>Serial number results</h3></div>
                  <div className="table-tools">
                    <div className="table-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search serial, model or spec" /></div>
                    <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter results"><option value="all">All rows</option><option value="complete">Specifications ready</option><option value="review">Needs review</option></select>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>No.</th><th>Serial no</th><th>Asset description</th><th>Existing CPU / RAM</th><th>HP CPU result</th><th>HP RAM result</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {filtered.map((record) => (
                        <tr key={record.id} className={record.status === 'looking' ? 'row-loading' : ''}>
                          <td className="row-number">{record.number}</td>
                          <td><strong className="serial-value">{record.serialNumber}</strong><small>{record.productNumber || record.asset}</small></td>
                          <td className="description-cell">{record.productName || record.description || '—'}</td>
                          <td className="existing-cell"><span>{record.existingCpu || 'CPU —'}</span><span>{record.existingRam || 'RAM —'}</span></td>
                          <td><input className="result-input" value={record.cpu} onChange={(event) => updateRecord(record.id, { cpu: event.target.value, status: 'review', validationStatus: 'review', manuallyReviewed: false })} placeholder={record.status === 'skipped' ? 'Not applicable' : record.status === 'looking' ? 'Looking up…' : 'Pending lookup'} disabled={record.status === 'skipped' || record.status === 'looking'} /></td>
                          <td><input className="result-input" value={record.ram} onChange={(event) => updateRecord(record.id, { ram: event.target.value, status: 'review', validationStatus: 'review', manuallyReviewed: false })} placeholder={record.status === 'skipped' ? 'Not applicable' : record.status === 'looking' ? 'Looking up…' : 'Pending lookup'} disabled={record.status === 'skipped' || record.status === 'looking'} /></td>
                          <td><span className={`table-status ${record.status}`}><i />{statusLabel(record.status)}</span>{(record.reviewReason || record.error) && <small className="row-error">{record.reviewReason || record.error}</small>}</td>
                          <td><button className="copy-row" onClick={() => { navigator.clipboard.writeText(`${record.cpu}\t${record.ram}`); notify(`Copied ${record.serialNumber}`); }} disabled={!record.cpu && !record.ram} aria-label={`Copy results for ${record.serialNumber}`}>▣</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  <div className="table-footer"><span>Showing {filtered.length} of {records.length} rows</span><span>“Inferred” uses one compatible HP spare. “Review” explains multiple options or missing serial-specific data.</span></div>
                </section>
              </>}
              {activeView === 'more' && <>
                <div className="export-note"><span>i</span><p><strong>More-info export</strong> The same flexible CPU/RAM placement rules are used, and a new <strong>More Device Info</strong> worksheet is added with available HP details and source links.</p></div>
                <section className="results-card more-results">
                  <div className="results-toolbar">
                    <div><span className="section-kicker"><span />HP DEVICE RECORDS</span><h3>More device information</h3></div>
                    <div className="table-tools">
                      <div className="table-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search serial, model or component" /></div>
                      <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter results"><option value="all">All rows</option><option value="complete">Information ready</option><option value="review">Needs review</option></select>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="more-table">
                      <thead><tr><th>No.</th><th>Device identity</th><th>CPU</th><th>RAM</th><th>Available device details</th><th>Validation & source</th></tr></thead>
                      <tbody>
                        {filtered.map((record) => {
                          const info = record.moreInfo;
                          const availableFields = selectedFieldDefinitions.filter((field) => info[field.key].length);
                          return <tr key={record.id}>
                            <td className="row-number">{record.number}</td>
                            <td><strong className="serial-value">{record.serialNumber}</strong><small>{record.productNumber || 'Product number pending'}</small><span className="device-name">{record.productName || record.description || 'Pending lookup'}</span></td>
                            <td className="primary-spec">{record.cpu || 'Pending lookup'}<small>{record.cpuSource === 'serial-bom' ? 'Installed configuration' : record.cpuSource || ''}</small></td>
                            <td className="primary-spec">{record.ram || 'Pending lookup'}<small>{record.ramSource === 'serial-bom' ? 'Installed configuration' : record.ramSource?.startsWith('spare') ? 'Compatible spare evidence' : record.ramSource || ''}</small></td>
                            <td>
                              <div className="detail-preview">
                                {availableFields.slice(0, 3).map((field) => <p key={field.key}><strong>{field.label}</strong><span>{info[field.key].join(' · ')}</span></p>)}
                                {!availableFields.length && <span className="pending-link">No selected component details listed by HP</span>}
                              </div>
                              <button className="details-button" onClick={() => setDetailRecordId(record.id)} disabled={!info.configurationItems.length}>View complete device record <span>→</span></button>
                            </td>
                            <td className="evidence-cell">
                              <span className={`validation-badge ${record.validationStatus}`}>{validationLabel(record.validationStatus)}</span>
                              <small>{record.validationSummary || 'Run lookup to generate evidence checks'}</small>
                              <button className="evidence-button" onClick={() => setDetailRecordId(record.id)} disabled={!record.cpuEvidence.length && !record.ramEvidence.length}>Review evidence</button>
                              {record.sourceUrl ? <a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer">Open HP source ↗</a> : <span className="pending-link">Pending lookup</span>}
                            </td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer"><span>Showing {filtered.length} of {records.length} rows</span><span>Only the serial-specific configuration is presented as device information; compatible spare parts remain clearly labelled.</span></div>
                </section>
              </>}
              {activeView === 'validation' && <>
                <div className="export-note validation-note"><span>✓</span><p><strong>Evidence-based validation</strong> The app compares each parsed result with the raw HP JSON configuration line retained during lookup. “Evidence supported” confirms parser traceability—not the device’s present physical configuration.</p></div>
                <section className="validation-summary">
                  <div><span>Automated evidence supported</span><strong>{evidenceSupported}</strong><small>All four source checks passed</small></div>
                  <div><span>Requires human review</span><strong>{evidenceReview}</strong><small>Inferred, missing or ambiguous evidence</small></div>
                  <div><span>Marked checked by user</span><strong>{manuallyReviewed}</strong><small>Reviewer compared the result and evidence</small></div>
                </section>
                <section className="results-card validation-results">
                  <div className="results-toolbar">
                    <div><span className="section-kicker"><span />VALIDATION REGISTER</span><h3>App result compared with raw HP evidence</h3></div>
                    <div className="table-tools">
                      <div className="table-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search serial, result or evidence" /></div>
                      <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter validation results"><option value="all">All rows</option><option value="complete">Supported</option><option value="review">Needs review</option></select>
                    </div>
                  </div>
                  <div className="validation-register">
                    {filtered.map((record) => <article className="validation-record" key={record.id}>
                      <header><div><span className="record-no">{record.number}</span><strong>{record.serialNumber}</strong><small>{record.productNumber || 'Product pending'} · {record.productName || record.description || 'Device pending'}</small></div><span className={`validation-badge ${record.validationStatus}`}>{validationLabel(record.validationStatus)}</span></header>
                      <div className="comparison-grid">
                        <section><div className="comparison-title"><strong>CPU</strong><span>{record.cpuSource || 'pending'}</span></div><div className="app-output"><small>APP OUTPUT</small><p>{record.cpu || 'Pending lookup'}</p></div><div className="raw-evidence"><small>RAW HP EVIDENCE USED</small>{record.cpuEvidence.length ? record.cpuEvidence.map((item) => <p key={item}>{item}</p>) : <p>No supporting CPU line returned</p>}</div></section>
                        <section><div className="comparison-title"><strong>RAM</strong><span>{record.ramSource || 'pending'}</span></div><div className="app-output"><small>APP OUTPUT</small><p>{record.ram || 'Pending lookup'}</p></div><div className="raw-evidence"><small>RAW HP EVIDENCE USED</small>{record.ramEvidence.length ? record.ramEvidence.map((item) => <p key={item}>{item}</p>) : <p>No supporting RAM line returned</p>}</div></section>
                      </div>
                      <div className="check-list">{record.validationChecks.length ? record.validationChecks.map((check) => <div key={check.key} className={check.status}><span>{check.status === 'pass' ? '✓' : '!'}</span><p><strong>{check.label}</strong>{check.detail}</p></div>) : <p className="pending-checks">Run the lookup to generate automated evidence checks.</p>}</div>
                      <footer className="validation-actions"><div><strong>{record.validationSummary || 'Validation pending'}</strong><small>{record.parserVersion}{record.lookedUpAt ? ` · ${record.lookupCountry} · ${new Date(record.lookedUpAt).toLocaleString('en-MY')}` : ''}</small></div><div>{record.sourceUrl && <a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer">Open HP source ↗</a>}<button className={record.manuallyReviewed ? 'reviewed' : ''} onClick={() => updateRecord(record.id, { manuallyReviewed: !record.manuallyReviewed })}>{record.manuallyReviewed ? '✓ Checked by reviewer' : 'Mark as checked'}</button></div></footer>
                    </article>)}
                  </div>
                  <div className="table-footer"><span>Showing {filtered.length} of {records.length} rows</span><span>Manual checking records review completion; it does not change inferred evidence into installed configuration.</span></div>
                </section>
              </>}
            </>
          )}

          {activeView === 'fields' && <section className="page-panel fields-panel">
            <div className="panel-heading"><span className="section-kicker"><span />OPTIONAL INFORMATION</span><h3>Configure display and full export</h3><p>CPU, RAM, confidence, review reasons and the HP source link are mandatory audit fields. Choose which additional component groups are shown and exported.</p></div>
            <div className="field-toolbar"><div><strong>{selectedFields.length} of {hardwareFieldDefinitions.length}</strong><span> optional groups selected</span></div><div><button onClick={() => setSelectedFields(defaultHardwareFields)}>Select all</button><button onClick={() => setSelectedFields([])}>Clear optional</button></div></div>
            <div className="field-grid">
              {hardwareFieldDefinitions.map((field) => {
                const selected = selectedFields.includes(field.key);
                return <button key={field.key} className={`field-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => setSelectedFields((current) => selected ? current.filter((key) => key !== field.key) : [...current, field.key])}>
                  <span className="field-check">{selected ? '✓' : '+'}</span><strong>{field.label}</strong><small>{field.description}</small>
                </button>;
              })}
            </div>
            <div className="mandatory-fields"><span>Always included</span><strong>Serial no · Product identity · CPU · RAM · Confidence · Evidence · Review reason · Malaysia lookup time · HP page</strong></div>
          </section>}

          {records.length > 0 && activeView === 'data' && <section className="page-panel data-panel">
            <div className="panel-heading"><span className="section-kicker"><span />CURRENT SOURCE</span><h3>{fileName}</h3><p>The workbook is held locally in this session. Replacing it resets the current lookup results.</p></div>
            <div className="data-summary"><div><span>Serial numbers detected</span><strong>{records.length}</strong></div><div><span>Eligible device lookups</span><strong>{searchable}</strong></div><div><span>Duplicate rows reused</span><strong>{duplicateCount}</strong></div><div><span>Skipped display/monitor rows</span><strong>{records.length - searchable}</strong></div></div>
            <div className="mapping-list">
              <div className="mapping-head"><strong>Detected workbook mapping</strong><span>Columns are detected per worksheet, not fixed to a template.</span></div>
              {sourceMappings.map((record) => <div className="mapping-row" key={record.sheetName}><strong>{record.sheetName}</strong><span>Header row {record.headerRow}</span><span>Serial column {record.serialColumn + 1}</span><span>{record.cpuColumn >= 0 ? `CPU column ${record.cpuColumn + 1}` : 'CPU column will be added'}</span><span>{record.ramColumn >= 0 ? `RAM column ${record.ramColumn + 1}` : 'RAM column will be added'}</span></div>)}
            </div>
            <button className="primary-action panel-button" onClick={() => fileInput.current?.click()}>Replace source workbook</button>
          </section>}

          {activeView === 'settings' && <section className="page-panel guide-panel">
            <div className="panel-heading"><span className="section-kicker"><span />DEMO & GOVERNANCE GUIDE</span><h3>How Serial Spec works—and where human review remains essential</h3><p>Use this page to explain the tool accurately to management, customers and asset-verification teams.</p></div>
            <div className="guide-flow">
              <div><span>1</span><strong>Import</strong><p>The app detects a serial-number heading and any existing CPU or RAM columns across worksheets.</p></div>
              <div><span>2</span><strong>Retrieve</strong><p>Each unique serial is sent to HP PartSurfer using the Malaysia country selection.</p></div>
              <div><span>3</span><strong>Classify</strong><p>Installed unit-configuration lines are separated from compatible service spare parts.</p></div>
              <div><span>4</span><strong>Review & export</strong><p>Users check warnings, open the HP source when needed and export without overwriting existing values.</p></div>
            </div>
            <div className="guide-grid">
              <div><span className="table-status found"><i />Exact BOM</span><strong>Confirmed serial configuration</strong><p>HP lists the component in the serial-specific unit configuration.</p></div>
              <div><span className="table-status inferred"><i />RAM inferred</span><strong>One compatible RAM spare</strong><p>The app displays the specification, but identifies it as inferred because HP does not show the installed module.</p></div>
              <div><span className="table-status review"><i />Review</span><strong>Multiple options or missing detail</strong><p>The result remains nonblank and includes the reason in parentheses, such as unconfirmed capacity or speed.</p></div>
            </div>
            <div className="business-guide-grid">
              <article><span>CAPABILITIES</span><h4>What the tool can retrieve</h4><p>CPU and RAM are the primary results. It also groups storage, GPU, display, battery, network, power, keyboard, system board, OS, optical, audio and other HP configuration lines when HP lists them.</p><p>Fields can be turned on or off for the More Info screen and full export.</p></article>
              <article><span>VALIDATION</span><h4>Three levels of assurance</h4><p><strong>1. Automated traceability:</strong> compare every app output with the retained raw HP line and four source checks.</p><p><strong>2. Human source review:</strong> open HP PartSurfer, compare the visible BOM and mark the row checked.</p><p><strong>3. Physical verification:</strong> for customer-critical delivery, confirm the present hardware in BIOS, Windows system inventory or by physical inspection. HP’s BOM may not reflect later upgrades or repairs.</p></article>
              <article className="limitations-card"><span>CURRENT LIMITATIONS</span><h4>What the result cannot guarantee</h4><ul><li>Only HP serials recognised by PartSurfer are supported.</li><li>Results depend on HP availability and the completeness of HP data.</li><li>Spare parts show compatibility, not necessarily what is installed.</li><li>Parts replaced after manufacture may not match the original BOM.</li><li>Display or monitor rows are skipped by the current asset rule.</li><li>Large batches take longer and may be rate-limited by HP.</li></ul></article>
            </div>
          </section>}
          <footer><span><i /> Local processing ready</span><span>Serial Spec Console · Workbook remains on this device</span></footer>
        </div>
      </section>
      {detailRecord && <div className="record-modal-backdrop" onMouseDown={() => setDetailRecordId(null)}>
        <section className="record-modal" role="dialog" aria-modal="true" aria-label={`Device record for ${detailRecord.serialNumber}`} onMouseDown={(event) => event.stopPropagation()}>
          <header className="record-modal-header"><div><span className="section-kicker"><span />COMPLETE DEVICE RECORD</span><h3>{detailRecord.serialNumber}</h3><p>{detailRecord.productNumber || 'Product number unavailable'} · {detailRecord.productName || detailRecord.description || 'Device name unavailable'}</p></div><button onClick={() => setDetailRecordId(null)} aria-label="Close device record">×</button></header>
          <div className="record-modal-summary"><div><span>CPU</span><strong>{detailRecord.cpu || 'Pending lookup'}</strong><small>{detailRecord.cpuSource || 'No classification'}</small></div><div><span>RAM</span><strong>{detailRecord.ram || 'Pending lookup'}</strong><small>{detailRecord.ramSource || 'No classification'}</small></div><div><span>Validation</span><strong><i className={`validation-badge ${detailRecord.validationStatus}`}>{validationLabel(detailRecord.validationStatus)}</i></strong><small>{detailRecord.validationSummary || 'Evidence checks pending'}</small></div></div>
          <div className="record-modal-body">
            <section><div className="modal-section-title"><span>01</span><div><strong>Available hardware information</strong><small>Serial-specific component groups returned by HP</small></div></div><div className="modal-info-grid">{selectedFieldDefinitions.map((field) => <div key={field.key}><strong>{field.label}</strong><p>{infoText(detailRecord.moreInfo[field.key])}</p></div>)}</div></section>
            <section><div className="modal-section-title"><span>02</span><div><strong>Raw HP evidence</strong><small>Exact descriptions used by the CPU and RAM parser</small></div></div><div className="modal-evidence-grid"><div><strong>CPU evidence</strong>{detailRecord.cpuEvidence.length ? detailRecord.cpuEvidence.map((item) => <p key={item}>{item}</p>) : <p>No CPU evidence returned by HP</p>}</div><div><strong>RAM evidence</strong>{detailRecord.ramEvidence.length ? detailRecord.ramEvidence.map((item) => <p key={item}>{item}</p>) : <p>No RAM evidence returned by HP</p>}</div></div></section>
            <section><div className="modal-section-title"><span>03</span><div><strong>Automated validation checks</strong><small>Traceability checks—not a substitute for physical verification</small></div></div><div className="modal-check-grid">{detailRecord.validationChecks.map((check) => <div key={check.key} className={check.status}><span>{check.status === 'pass' ? '✓' : '!'}</span><p><strong>{check.label}</strong>{check.detail}</p></div>)}</div>{detailRecord.reviewReason && <div className="review-callout"><strong>Review reason</strong>{detailRecord.reviewReason}</div>}</section>
          </div>
          <footer className="record-modal-footer"><div><span>{detailRecord.moreInfo.configurationItems.length} installed-configuration lines</span><span>{detailRecord.moreInfo.sparePartCount} compatible service spares</span><span>{detailRecord.lookupCountry || 'Malaysia'} lookup</span></div>{detailRecord.sourceUrl && <a className="modal-source-button" href={detailRecord.sourceUrl} target="_blank" rel="noreferrer">Open original HP page ↗</a>}</footer>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
