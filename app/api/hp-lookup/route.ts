import { NextResponse } from 'next/server';
import { extractProductCandidates } from '@/app/lib/hp/payload-adapter';
import { resolveProduct } from '@/app/lib/hp/product-resolver';
import { parseSpecifications } from '@/app/lib/hp/spec-parser';
import { validateDevice } from '@/app/lib/hp/validation';

type HpPart = Record<string, string | number | null | undefined>;
type HpSerialBom = {
  unit_configuration?: HpPart[];
  spare_part?: HpPart[];
  wwsnrsinput?: { product_no?: unknown; user_name?: unknown };
  roHS_unit_status?: { rohs_status_code?: unknown };
};
type HpPayload = { Body?: { SerialNumberBOM?: HpSerialBom } };
type RamSpec = { capacity: string; generation: string; speed: string; voltage: string; form: string; ecc: string };

const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const hpCountryCode = 'MY';
const hpCountryName = 'Malaysia';
const cpuPattern = /\b(?:(?:core\s+)?ultra\s+[3579]\s+\d{3}[a-z]{0,2}|i[3579]-\d{4,5}[a-z]{0,3}|xeon(?:\s+[a-z0-9-]+){1,3}|ryzen(?:\s+ai)?\s+\d+(?:\s+pro)?(?:\s+[a-z0-9-]+){0,2}|celeron(?:\s+[a-z0-9-]+){1,2}|pentium(?:\s+[a-z0-9-]+){1,2})\b/i;
const memoryPattern = /(\d+)\s*GB.*(?:DDR[345]|LPDDR[345X]*|UDIMM|SODIMM)|(?:DDR[345]|LPDDR[345X]*|UDIMM|SODIMM).*?(\d+)\s*GB/i;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

function describeCpu(unitParts: HpPart[], spareParts: HpPart[]) {
  const unit = unitParts.find((part) => {
    const partText = normalize(part.part_description);
    return !/heat\s?sink|thermal/i.test(partText) && cpuPattern.test(partText);
  });
  if (!unit) return {
    value: 'CPU not listed by HP (Review: serial configuration does not identify a processor)',
    source: 'not-listed', evidence: [],
    reason: 'HP does not identify a processor in the serial-specific configuration.',
  };

  const unitText = normalize(unit.part_description);
  const model = unitText.match(cpuPattern)?.[0] ?? unitText;
  const spareText = normalize(spareParts.find((part) => {
    const partText = normalize(part.spare_part_description);
    return partText.toLowerCase().includes(model.toLowerCase()) && /(cpu|processor|system board)/i.test(partText) && !/heat\s?sink/i.test(partText);
  })?.spare_part_description);
  const details = `${unitText} ${spareText}`;
  const cores = details.match(/(?:^|\s)(\d{1,2})C(?:\s|$)/i)?.[1];
  const speed = details.match(/(\d+(?:\.\d+)?)\s*GHz/i)?.[1];
  const watts = details.match(/(\d{2,3})\s*W(?:\s|$)/i)?.[1];
  const brand = /^i[3579]-/i.test(model) ? `Intel Core ${model}` : /^(?:core\s+)?ultra/i.test(model) ? `Intel Core ${model.replace(/^core\s+/i, '')}` : model;
  return {
    value: [brand, cores ? `${cores} cores` : '', speed ? `${speed} GHz` : '', watts ? `${watts} W` : ''].filter(Boolean).join(', '),
    source: 'serial-bom', evidence: unique([unitText, spareText]), reason: '',
  };
}

function parseRam(value: string): RamSpec {
  return {
    capacity: value.match(/(\d+)\s*GB/i)?.[1] ?? '',
    generation: value.match(/LPDDR[345X]*|DDR[345]/i)?.[0]?.toUpperCase() ?? '',
    speed: value.match(/(?:LP?DDR[345X]*)[- ](\d{3,5})/i)?.[1] ?? '',
    voltage: value.match(/\d+(?:\.\d+)?\s*[vV]/)?.[0] ?? '',
    form: value.match(/SODIMM|UDIMM/i)?.[0]?.toUpperCase() ?? '',
    ecc: /NECC|NON[- ]?ECC/i.test(value) ? 'non-ECC' : /\bECC\b/i.test(value) ? 'ECC' : '',
  };
}

function formatRam(spec: RamSpec) {
  const generation = spec.generation ? `${spec.generation}${spec.speed ? `-${spec.speed}` : ''}` : '';
  return [spec.capacity ? `${spec.capacity} GB` : '', generation, spec.voltage, spec.ecc, spec.form].filter(Boolean).join(', ');
}

function describeRam(unitParts: HpPart[], spareParts: HpPart[]) {
  const unitCandidates = unique(unitParts.map((part) => normalize(part.part_description)).filter((partText) => memoryPattern.test(partText)));
  if (unitCandidates.length) return {
    value: unique(unitCandidates.map((candidate) => formatRam(parseRam(candidate)))).join(' + '),
    source: 'serial-bom', candidates: unitCandidates, evidence: unitCandidates, reason: '',
  };

  const candidates = unique(spareParts.map((part) => normalize(part.spare_part_description)).filter((partText) => memoryPattern.test(partText)));
  if (!candidates.length) return {
    value: 'RAM unavailable (Review: HP does not list installed or compatible memory)', source: 'not-listed', candidates,
    evidence: [],
    reason: 'HP does not list installed memory or a compatible RAM spare for this serial number.',
  };
  if (candidates.length === 1) return {
    value: formatRam(parseRam(candidates[0])), source: 'spare-bom', candidates,
    evidence: candidates,
    reason: 'RAM is inferred from the single compatible HP spare; the installed module is not shown in the serial-specific configuration.',
  };

  const specs = candidates.map(parseRam);
  const capacities = unique(specs.map((spec) => spec.capacity)).sort((a, b) => Number(a) - Number(b));
  const generations = unique(specs.map((spec) => spec.generation));
  const speeds = unique(specs.map((spec) => spec.speed)).sort((a, b) => Number(a) - Number(b));
  const forms = unique(specs.map((spec) => spec.form));
  const eccValues = unique(specs.map((spec) => spec.ecc));
  const sharedCapacity = capacities.length === 1 ? `${capacities[0]} GB` : `${capacities.join(' / ')} GB possible`;
  const sharedGeneration = generations.length === 1 ? generations[0] : 'RAM';
  const sharedDetails = [sharedCapacity, sharedGeneration, forms.length === 1 ? forms[0] : '', eccValues.length === 1 ? eccValues[0] : ''].filter(Boolean).join(', ');
  let shortReason: string;
  let reason: string;
  if (capacities.length > 1) {
    shortReason = `multiple compatible capacities (${capacities.join(' / ')} GB); installed capacity not confirmed`;
    reason = `HP lists multiple compatible RAM capacities (${capacities.join(' GB, ')} GB). The serial-specific configuration does not confirm which capacity is installed.`;
  } else if (speeds.length > 1) {
    shortReason = `multiple compatible speeds (${speeds.join(' / ')}); installed speed not confirmed`;
    reason = `HP lists multiple compatible RAM speeds (${speeds.map((speed) => `${sharedGeneration}-${speed}`).join(', ')}). Capacity and memory type agree, but the installed speed is not confirmed.`;
  } else {
    shortReason = 'multiple compatible HP spare parts; installed module not confirmed';
    reason = 'HP lists multiple compatible RAM spare parts. Their common specification is shown, but the installed module is not confirmed.';
  }
  return { value: `${sharedDetails} (Review: ${shortReason})`, source: 'spare-bom-review', candidates, evidence: candidates, reason };
}

function buildMoreInfo(unitParts: HpPart[], spareParts: HpPart[], serialBom: HpSerialBom) {
  const metadata = new Map<string, string>();
  const hardware = unitParts.flatMap((part) => {
    const partNumber = normalize(part.part_number);
    const description = normalize(part.part_description);
    if (!description || description === '-N/A-') return [];
    if (/^(IMG_|MAC_|PCA_MAC|MANUF_DATE|UUID_)/i.test(partNumber)) {
      metadata.set(partNumber.toUpperCase(), description.replace(/^[^=]+=\s*/, ''));
      return [];
    }
    return [{ partNumber, description, quantity: normalize(part.quantity) }];
  });

  const categories: Array<[string, RegExp]> = [
    ['storage', /\b(HDD|SSD|NVME|M\.?2|EMMC|HARD DRIVE|SOLID STATE)\b/i],
    ['graphics', /\b(GPU|GRAPHICS|GEFORCE|RADEON|QUADRO|NVIDIA|INTEL UHD|INTEL IRIS)\b/i],
    ['display', /\b(LCD|DISPLAY|PANEL|TOUCHSCREEN)\b/i],
    ['battery', /\b(BATTERY|BATT)\b/i],
    ['network', /\b(WLAN|WI-?FI|WIRELESS|BLUETOOTH|ETHERNET|LAN|NIC)\b/i],
    ['power', /\b(P\/S|PSU|POWER SUPPLY|AC ADAPTER|POWER ADAPTER|ADAPTER)\b/i],
    ['keyboard', /\b(KEYBOARD|KBD|TOP COVER.*KB|KB.*TOP COVER)\b/i],
    ['systemBoard', /\b(MBD|SYSTEM BOARD|MOTHERBOARD|MAINBOARD)\b/i],
    ['operatingSystem', /\b(DPK|WINDOWS|WIN\s?10|WIN\s?11|FREEDOS|CHROME\s?OS)\b/i],
    ['optical', /\b(ODD|DVD|CD-ROM|OPTICAL)\b/i],
    ['audio', /\b(AUDIO|SPEAKER|MICROPHONE)\b/i],
  ];
  const grouped: Record<string, string[]> = Object.fromEntries(categories.map(([name]) => [name, []]));
  const otherComponents: string[] = [];
  for (const part of hardware) {
    if (cpuPattern.test(part.description) || memoryPattern.test(part.description)) continue;
    const match = categories.find(([, pattern]) => pattern.test(part.description));
    if (match) grouped[match[0]].push(part.description);
    else otherComponents.push(part.description);
  }

  return {
    storage: unique(grouped.storage), graphics: unique(grouped.graphics), display: unique(grouped.display),
    battery: unique(grouped.battery), network: unique(grouped.network), power: unique(grouped.power),
    keyboard: unique(grouped.keyboard), systemBoard: unique(grouped.systemBoard),
    operatingSystem: unique(grouped.operatingSystem), optical: unique(grouped.optical), audio: unique(grouped.audio),
    otherComponents: unique(otherComponents), buildId: metadata.get('IMG_BUILDID') ?? '',
    featureByte: metadata.get('IMG_FEATUREBYTE') ?? '', macAddress: metadata.get('MAC_ADDR1') ?? metadata.get('PCA_MAC1') ?? '',
    manufactureDate: metadata.get('MANUF_DATE') ?? '',
    uuid: [metadata.get('UUID_HALF1'), metadata.get('UUID_HALF2')].filter(Boolean).join(''),
    rohsStatus: normalize(serialBom?.roHS_unit_status?.rohs_status_code), configurationItems: hardware,
    sparePartCount: spareParts.length,
  };
}

export async function POST(request: Request) {
  const lookedUpAt = new Date().toISOString();
  try {
    const { serial, modelHint, productNumberHint } = await request.json() as {
      serial?: string;
      modelHint?: string;
      productNumberHint?: string;
    };
    const cleanSerial = normalize(serial).toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(cleanSerial)) return json({ error: 'Enter a valid device serial number.' }, 400);

    const input = `/SerialNumber/GetSerialNumber/${encodeURIComponent(cleanSerial)}/country/${hpCountryCode}/usertype/EXT`;
    const response = await fetch(`https://partsurfer.hpcloud.hp.com/bff/proxy/get?input=${input}`, {
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'application/json, text/plain, */*', Origin: 'https://partsurfer.hp.com',
        Referer: 'https://partsurfer.hp.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      console.warn('HP PartSurfer lookup failed', { status: response.status, country: hpCountryCode });
      return json({ error: 'HP PartSurfer is temporarily unavailable. Please retry this row.' }, response.status === 429 ? 429 : 502);
    }
    let payload = await response.json() as HpPayload & { Body?: Record<string, unknown> };
    const candidates = extractProductCandidates(payload, cleanSerial);
    let resolution = resolveProduct(candidates, { serial: cleanSerial, modelHint, productNumberHint });
    let selected = resolution.selected;

    const requiresProductSelection = Array.isArray(payload.Body?.SNRProductLists)
      && payload.Body.SNRProductLists.length > 0;
    if (requiresProductSelection && selected?.productNumber) {
      const selectedProductNumber = selected.productNumber;
      const selectedInput = `/SerialNumber/GetSerialNumber/${encodeURIComponent(cleanSerial)}/ProductNumber/${encodeURIComponent(selectedProductNumber)}/country/${hpCountryCode}/usertype/EXT`;
      const selectedResponse = await fetch(`https://partsurfer.hpcloud.hp.com/bff/proxy/get?input=${selectedInput}`, {
        cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: 'application/json, text/plain, */*', Origin: 'https://partsurfer.hp.com',
          Referer: 'https://partsurfer.hp.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
        },
      });
      if (!selectedResponse.ok) {
        console.warn('HP PartSurfer selected-product lookup failed', {
          status: selectedResponse.status,
          country: hpCountryCode,
          productNumber: selectedProductNumber,
        });
        return json({ error: 'HP PartSurfer could not load the selected product configuration. Please retry this row.' }, selectedResponse.status === 429 ? 429 : 502);
      }

      const selectedPayload = await selectedResponse.json() as HpPayload & { Body?: Record<string, unknown> };
      const selectedCandidates = extractProductCandidates(selectedPayload, cleanSerial);
      const loadedProduct = selectedCandidates.find((candidate) => normalize(candidate.productNumber).toUpperCase() === normalize(selectedProductNumber).toUpperCase());
      if (loadedProduct) {
        payload = selectedPayload;
        selected = loadedProduct;
        resolution = { ...resolution, selected: loadedProduct };
      } else {
        selected = undefined;
        resolution = {
          status: 'UNRESOLVED',
          candidates,
          matchMethod: 'not-found',
          reason: `HP listed product ${selectedProductNumber}, but did not return its serial-specific configuration.`,
        };
      }
    }
    const unitParts = (selected?.unitConfiguration ?? []) as HpPart[];
    const spareParts = (selected?.spareParts ?? []) as HpPart[];
    const specifications = parseSpecifications({ unitConfiguration: unitParts, spareParts });
    const validation = validateDevice(resolution, specifications);
    const cpuSpec = specifications.find((specification) => specification.field === 'cpu');
    const ramSpec = specifications.find((specification) => specification.field === 'ram');
    const cpu = cpuSpec ? {
      value: cpuSpec.normalizedValue,
      source: cpuSpec.evidenceType,
      evidence: cpuSpec.evidence.map((item) => item.hpDescription),
      reason: cpuSpec.reviewReason ?? '',
    } : describeCpu(unitParts, spareParts);
    const ram = ramSpec ? {
      value: ramSpec.normalizedValue,
      source: ramSpec.evidenceType === 'compatible-spare' ? (ramSpec.evidence.length > 1 ? 'spare-bom-review' : 'spare-bom') : ramSpec.evidenceType,
      candidates: ramSpec.evidence.map((item) => item.hpDescription),
      evidence: ramSpec.evidence.map((item) => item.hpDescription),
      reason: ramSpec.reviewReason ?? '',
    } : describeRam(unitParts, spareParts);
    const serialBomValue = payload?.Body?.SerialNumberBOM;
    const serialBom = (!Array.isArray(serialBomValue) && serialBomValue && typeof serialBomValue === 'object'
      ? serialBomValue : {}) as HpSerialBom;
    const reasons = unique([validation.reason, cpu.reason, ram.reason]);
    const validationChecks = validation.checks;
    const passedChecks = validationChecks.filter((check) => check.status === 'pass').length;
    const validationStatus = validation.status === 'VERIFIED' ? 'supported'
      : validation.status === 'UNRESOLVED' ? 'unavailable' : 'review';
    return json({
      serial: cleanSerial, productNumber: selected?.productNumber ?? '', productName: selected?.productName ?? '',
      cpu: cpu.value, ram: ram.value, cpuSource: cpu.source, ramSource: ram.source,
      cpuEvidence: cpu.evidence, ramEvidence: ram.evidence, ramCandidates: ram.candidates ?? [],
      reviewReason: reasons.join(' '), validationStatus, validationChecks,
      validationSummary: `${passedChecks}/${validationChecks.length} automated evidence checks passed`,
      validationStatusLabel: validation.status,
      parserVersion: 'HP BOM parser 3.0',
      resolution: {
        status: resolution.status,
        matchMethod: resolution.matchMethod,
        reason: resolution.reason,
        candidateCount: resolution.candidates.length,
        candidates: resolution.candidates.map((candidate) => ({
          productNumber: candidate.productNumber,
          productName: candidate.productName,
          serialNumber: candidate.serialNumber ?? '',
        })),
      },
      specifications,
      moreInfo: buildMoreInfo(unitParts, spareParts, serialBom),
      found: Boolean(candidates.length),
      sourceUrl: `https://partsurfer.hp.com/?searchtext=${encodeURIComponent(cleanSerial)}&searchby=swp`,
      lookupCountry: hpCountryName, lookedUpAt, unitConfigurationCount: unitParts.length,
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    console.error('HP PartSurfer lookup error', { timedOut, errorName: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: timedOut ? 'HP PartSurfer did not respond in time. Please retry this row.' : 'The HP lookup could not be completed. Please try again.' }, 502);
  }
}
