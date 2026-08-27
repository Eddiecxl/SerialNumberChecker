'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell as XlsxCell } from 'xlsx-populate/browser/xlsx-populate';

type RowStatus = 'ready' | 'looking' | 'found' | 'inferred' | 'review' | 'skipped' | 'error';
type ActiveView = 'specs' | 'more' | 'data' | 'settings';

type DeviceMoreInfo = {
  storage: string[];
  operatingSystem: string[];
  power: string[];
  systemBoard: string[];
  graphics: string[];
  network: string[];
  display: string[];
  optical: string[];
  battery: string[];
  audio: string[];
  otherComponents: string[];
  buildId: string;
  featureByte: string;
  macAddress: string;
  manufactureDate: string;
  uuid: string;
  rohsStatus: string;
  configurationItems: Array<{ partNumber: string; description: string; quantity: string }>;
  sparePartCount: number;
};

const emptyMoreInfo: DeviceMoreInfo = {
  storage: [], operatingSystem: [], power: [], systemBoard: [], graphics: [], network: [],
  display: [], optical: [], battery: [], audio: [], otherComponents: [], buildId: '', featureByte: '',
  macAddress: '', manufactureDate: '', uuid: '', rohsStatus: '', configurationItems: [], sparePartCount: 0,
};

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
  reviewReason: string;
  sourceUrl: string;
  moreInfo: DeviceMoreInfo;
  status: RowStatus;
  error?: string;
};

type HpResponse = {
  cpu: string;
  ram: string;
  cpuSource: string;
  ramSource: string;
  productName: string;
  productNumber: string;
  found: boolean;
  ramCandidates?: string[];
  reviewReason?: string;
  sourceUrl: string;
  moreInfo: DeviceMoreInfo;
  error?: string;
};

const serialHeaders = ['serialno', 'serialnumber', 'deviceserial', 'serial', 'servicetag', 'sn'];
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

const infoText = (values: string[]) => values.length ? values.join(' · ') : 'Not listed by HP';

export default function Home() {
  const [records, setRecords] = useState<SheetRecord[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>('specs');
  const [fileName, setFileName] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete' | 'review'>('all');
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState('');
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
        const headerIndex = matrix.slice(0, 20).findIndex((row: unknown[]) =>
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
            reviewReason: '', sourceUrl: '', moreInfo: { ...emptyMoreInfo },
            status: /monitor|display/i.test(description) ? 'skipped' : 'ready',
          });
        });
      }
      if (!found.length) throw new Error('No Serial No column was found');
      originalBuffer.current = buffer.slice(0);
      setRecords(found);
      setFileName(name);
      setProcessed(0);
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
    let cursor = 0;
    const worker = async () => {
      while (!stopRequested.current) {
        const target = queue[cursor++];
        if (!target) break;
        updateRecord(target.id, { status: 'looking', error: '' });
        try {
          const response = await fetch('/api/hp-lookup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serial: target.serialNumber }),
          });
          const data = await response.json() as HpResponse;
          if (!response.ok) throw new Error(data.error || 'Lookup failed');
          const status: RowStatus = !data.found || data.cpuSource === 'not-listed' || ['spare-bom-review', 'not-listed'].includes(data.ramSource)
            ? 'review' : data.ramSource === 'spare-bom' ? 'inferred' : 'found';
          updateRecord(target.id, {
            cpu: data.cpu, ram: data.ram, cpuSource: data.cpuSource, ramSource: data.ramSource,
            productName: data.productName, productNumber: data.productNumber, status,
            reviewReason: data.reviewReason ?? '', sourceUrl: data.sourceUrl,
            moreInfo: data.moreInfo ?? { ...emptyMoreInfo }, error: '',
          });
        } catch (error) {
          updateRecord(target.id, { status: 'error', error: error instanceof Error ? error.message : 'Lookup failed' });
        } finally {
          setProcessed((value) => value + 1);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
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
        const headers = [
          'No.', 'Serial no', 'Product number', 'Product name', 'Asset description', 'Storage',
          'Operating system', 'Power', 'System board', 'Graphics', 'Network', 'Display', 'Optical drive',
          'Battery', 'Audio', 'Build ID', 'Feature byte', 'MAC address', 'Manufacture date', 'UUID',
          'RoHS status', 'Other configuration', 'Installed configuration items', 'Compatible spare-parts count',
          'Review reason', 'HP PartSurfer page',
        ];
        const rows = records.map((record) => {
          const info = record.moreInfo;
          const join = (values: string[]) => values.join(' | ');
          return [
            record.number, record.serialNumber, record.productNumber, record.productName || record.description,
            record.description, join(info.storage), join(info.operatingSystem), join(info.power), join(info.systemBoard),
            join(info.graphics), join(info.network), join(info.display), join(info.optical), join(info.battery),
            join(info.audio), info.buildId, info.featureByte, info.macAddress, info.manufactureDate, info.uuid,
            info.rohsStatus, join(info.otherComponents),
            info.configurationItems.map((item) => `${item.partNumber}: ${item.description}${item.quantity ? ` × ${item.quantity}` : ''}`).join(' | '),
            info.sparePartCount || '', record.reviewReason, record.sourceUrl,
          ];
        });
        infoSheet.cell('A1').value([headers, ...rows]);
        infoSheet.range(1, 1, 1, headers.length).style({
          bold: true, fontColor: 'FFFFFF', fill: '173D83', verticalAlignment: 'center', wrapText: true,
        });
        infoSheet.range(2, 1, rows.length + 1, headers.length).style({
          verticalAlignment: 'top', wrapText: true, fontSize: 9,
        });
        [7, 15, 15, 28, 28, 26, 20, 24, 26, 22, 22, 20, 18, 18, 18, 20, 24, 18, 16, 22, 18, 34, 60, 16, 46, 45]
          .forEach((width, index) => infoSheet.column(index + 1).width(width));
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
    const matchesQuery = `${record.serialNumber} ${record.description} ${record.productName} ${record.productNumber} ${record.cpu} ${record.ram} ${Object.values(info).flat().join(' ')} ${componentText}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'complete' && ['found', 'inferred'].includes(record.status)) || (filter === 'review' && ['review', 'error'].includes(record.status));
    return matchesQuery && matchesFilter;
  }), [records, query, filter]);

  const searchable = records.filter((record) => record.status !== 'skipped').length;
  const completed = records.filter((record) => ['found', 'inferred'].includes(record.status)).length;
  const reviewCount = records.filter((record) => ['review', 'error'].includes(record.status)).length;
  const progress = searchable ? Math.min(100, Math.round((processed / searchable) * 100)) : 0;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><img src="/ctc-logo.png" alt="CTC — Challenging Tomorrow's Changes" /></div>
        <nav aria-label="Main navigation">
          <button className={`nav-icon ${activeView === 'specs' ? 'active' : ''}`} aria-current={activeView === 'specs' ? 'page' : undefined} onClick={() => setActiveView('specs')}><span className="nav-glyph">▦</span><small>CPU & RAM</small></button>
          <button className={`nav-icon ${activeView === 'more' ? 'active' : ''}`} aria-current={activeView === 'more' ? 'page' : undefined} onClick={() => setActiveView('more')}><span className="nav-glyph">≡</span><small>More info</small></button>
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
            <div className="sync-pill"><span className="pulse-dot" />{fileName || 'Waiting for workbook'}</div>
            <button className="import-button" onClick={() => fileInput.current?.click()}>Import Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx" onChange={importExcel} hidden />
          </div>
        </header>

        <div className="batch-content">
          <section className="batch-hero">
            <div className="batch-copy">
              <span className="section-kicker"><span />{activeView === 'more' ? 'DEVICE DETAILS' : activeView === 'data' ? 'DATA SOURCE' : activeView === 'settings' ? 'WORKFLOW GUIDE' : 'BULK ENRICHMENT'}</span>
              {activeView === 'more' ? <><h2>See the device<br /><em>beyond CPU and RAM.</em></h2><p>The same HP lookup also collects product identity, storage, operating system, power, system board, identifiers, compliance and every serial-specific configuration line HP provides.</p></>
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

          {records.length > 0 && (activeView === 'specs' || activeView === 'more') && (
            <>
              <section className="control-deck">
                <div className="action-buttons">
                  {!running ? <button className="primary-action" onClick={runLookup}><span>▶</span>{processed ? 'Run lookup again' : 'Start HP lookup'}</button>
                    : <button className="stop-action" onClick={stopLookup}><span>■</span>Pause lookup</button>}
                  {activeView === 'specs' && <button className="secondary-action" onClick={copyResults}>Copy CPU & RAM</button>}
                  <button className="export-action" onClick={() => exportWorkbook(activeView === 'more')} disabled={!completed && !reviewCount}>
                    {activeView === 'more' ? 'Export more info' : 'Export enriched Excel'} <span>↓</span>
                  </button>
                </div>
                <div className="progress-block">
                  <div><span>{running ? 'HP lookup in progress' : processed ? 'Latest lookup progress' : 'Ready to begin'}</span><strong>{progress}%</strong></div>
                  <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
                  <small>{processed} of {searchable} eligible serial numbers processed</small>
                </div>
              </section>

              <section className="stat-grid">
                <div><span className="stat-icon blue">#</span><p>Total serial numbers<strong>{records.length}</strong></p></div>
                <div><span className="stat-icon mint">✓</span><p>Specifications ready<strong>{completed}</strong></p></div>
                <div><span className="stat-icon amber">!</span><p>Needs review<strong>{reviewCount}</strong></p></div>
                <div><span className="stat-icon grey">–</span><p>Not applicable<strong>{records.length - searchable}</strong></p></div>
              </section>

              {activeView === 'specs' ? <>
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
                          <td><input className="result-input" value={record.cpu} onChange={(event) => updateRecord(record.id, { cpu: event.target.value, status: 'review' })} placeholder={record.status === 'skipped' ? 'Not applicable' : record.status === 'looking' ? 'Looking up…' : 'Pending lookup'} disabled={record.status === 'skipped' || record.status === 'looking'} /></td>
                          <td><input className="result-input" value={record.ram} onChange={(event) => updateRecord(record.id, { ram: event.target.value, status: 'review' })} placeholder={record.status === 'skipped' ? 'Not applicable' : record.status === 'looking' ? 'Looking up…' : 'Pending lookup'} disabled={record.status === 'skipped' || record.status === 'looking'} /></td>
                          <td><span className={`table-status ${record.status}`}><i />{statusLabel(record.status)}</span>{(record.reviewReason || record.error) && <small className="row-error">{record.reviewReason || record.error}</small>}</td>
                          <td><button className="copy-row" onClick={() => { navigator.clipboard.writeText(`${record.cpu}\t${record.ram}`); notify(`Copied ${record.serialNumber}`); }} disabled={!record.cpu && !record.ram} aria-label={`Copy results for ${record.serialNumber}`}>▣</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  <div className="table-footer"><span>Showing {filtered.length} of {records.length} rows</span><span>“Inferred” uses one compatible HP spare. “Review” explains multiple options or missing serial-specific data.</span></div>
                </section>
              </> : <>
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
                      <thead><tr><th>No.</th><th>Device identity</th><th>Storage</th><th>Operating system</th><th>System board</th><th>Power</th><th>All available details</th><th>HP page</th></tr></thead>
                      <tbody>
                        {filtered.map((record) => {
                          const info = record.moreInfo;
                          return <tr key={record.id}>
                            <td className="row-number">{record.number}</td>
                            <td><strong className="serial-value">{record.serialNumber}</strong><small>{record.productNumber || 'Product number pending'}</small><span className="device-name">{record.productName || record.description || 'Pending lookup'}</span></td>
                            <td>{infoText(info.storage)}</td>
                            <td>{infoText(info.operatingSystem)}</td>
                            <td>{infoText(info.systemBoard)}</td>
                            <td>{infoText(info.power)}</td>
                            <td>
                              <details className="device-details">
                                <summary>{info.configurationItems.length ? `${info.configurationItems.length} configuration items` : 'No details yet'}</summary>
                                <div className="detail-grid">
                                  <p><strong>Graphics</strong>{infoText(info.graphics)}</p><p><strong>Network</strong>{infoText(info.network)}</p>
                                  <p><strong>Display</strong>{infoText(info.display)}</p><p><strong>Optical drive</strong>{infoText(info.optical)}</p>
                                  <p><strong>Battery</strong>{infoText(info.battery)}</p><p><strong>Audio</strong>{infoText(info.audio)}</p>
                                  <p><strong>Build ID</strong>{info.buildId || 'Not listed by HP'}</p><p><strong>Feature byte</strong>{info.featureByte || 'Not listed by HP'}</p>
                                  <p><strong>MAC address</strong>{info.macAddress || 'Not listed by HP'}</p><p><strong>Manufacture date</strong>{info.manufactureDate || 'Not listed by HP'}</p>
                                  <p><strong>UUID</strong>{info.uuid || 'Not listed by HP'}</p><p><strong>RoHS status</strong>{info.rohsStatus || 'Not listed by HP'}</p>
                                </div>
                                {info.otherComponents.length > 0 && <div className="component-list"><strong>Other serial-specific configuration</strong>{info.otherComponents.map((item) => <span key={item}>{item}</span>)}</div>}
                                {record.reviewReason && <div className="review-callout"><strong>Review reason</strong>{record.reviewReason}</div>}
                                <small className="spare-count">HP also lists {info.sparePartCount} compatible service spare parts. These are not treated as confirmed installed components.</small>
                              </details>
                            </td>
                            <td>{record.sourceUrl ? <a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer">Open PartSurfer ↗</a> : <span className="pending-link">Pending lookup</span>}</td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer"><span>Showing {filtered.length} of {records.length} rows</span><span>Only the serial-specific configuration is presented as device information; compatible spare parts remain clearly labelled.</span></div>
                </section>
              </>}
            </>
          )}

          {records.length > 0 && activeView === 'data' && <section className="page-panel data-panel">
            <div className="panel-heading"><span className="section-kicker"><span />CURRENT SOURCE</span><h3>{fileName}</h3><p>The workbook is held locally in this session. Replacing it resets the current lookup results.</p></div>
            <div className="data-summary"><div><span>Serial numbers detected</span><strong>{records.length}</strong></div><div><span>Eligible device lookups</span><strong>{searchable}</strong></div><div><span>Skipped display/monitor rows</span><strong>{records.length - searchable}</strong></div></div>
            <button className="primary-action panel-button" onClick={() => fileInput.current?.click()}>Replace source workbook</button>
          </section>}

          {activeView === 'settings' && <section className="page-panel guide-panel">
            <div className="panel-heading"><span className="section-kicker"><span />REVIEW RULES</span><h3>How Serial Spec decides what to export</h3></div>
            <div className="guide-grid">
              <div><span className="table-status found"><i />Exact BOM</span><strong>Confirmed serial configuration</strong><p>HP lists the component in the serial-specific unit configuration.</p></div>
              <div><span className="table-status inferred"><i />RAM inferred</span><strong>One compatible RAM spare</strong><p>The app displays the specification, but identifies it as inferred because HP does not show the installed module.</p></div>
              <div><span className="table-status review"><i />Review</span><strong>Multiple options or missing detail</strong><p>The result remains nonblank and includes the reason in parentheses, such as unconfirmed capacity or speed.</p></div>
            </div>
          </section>}
          <footer><span><i /> Local processing ready</span><span>Serial Spec Console · Workbook remains on this device</span></footer>
        </div>
      </section>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
