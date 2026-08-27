import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const baseDirectory = resolve(process.cwd(), '..', 'Base files');
const outputDirectory = resolve(process.cwd(), 'public', 'data');
const outputFile = join(outputDirectory, 'devices.json');
const workbookFile = join(outputDirectory, 'source-workbook.xlsx');
const manifestFile = join(outputDirectory, 'workbook-manifest.json');
const cloudMode = process.argv.includes('--cloud');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const [headings = [], ...dataRows] = rows;
  return dataRows.map((values) => Object.fromEntries(headings.map((heading, index) => [heading, values[index] ?? ''])));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }));
  return files.flat();
}

async function main() {
  let paths = [];
  try { paths = await collectFiles(baseDirectory); } catch { paths = []; }
  const records = [];
  let workbookSource = null;
  for (const path of paths) {
    const extension = extname(path).toLowerCase();
    if (extension === '.xlsx' && !workbookSource) workbookSource = path;
    if (extension !== '.csv' && extension !== '.json') continue;
    try {
      const text = await readFile(path, 'utf8');
      if (extension === '.csv') records.push(...parseCsv(text));
      else {
        const parsed = JSON.parse(text);
        records.push(...(Array.isArray(parsed) ? parsed : Array.isArray(parsed.devices) ? parsed.devices : []));
      }
    } catch (error) { console.warn(`Skipped ${path}: ${error.message}`); }
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  if (workbookSource && !cloudMode) {
    await copyFile(workbookSource, workbookFile);
    await writeFile(manifestFile, `${JSON.stringify({
      name: workbookSource.split(/[\\/]/).pop(),
      url: '/data/source-workbook.xlsx',
    }, null, 2)}\n`, 'utf8');
  } else {
    if (cloudMode) {
      try { await unlink(workbookFile); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await writeFile(manifestFile, 'null\n', 'utf8');
  }
  console.log(cloudMode
    ? `Prepared privacy-safe cloud data with no bundled workbook (${records.length} legacy device record(s)).`
    : `Synced ${records.length} device record(s) and ${workbookSource ? '1 workbook' : 'no workbook'} from Base files.`);
}

await main();
