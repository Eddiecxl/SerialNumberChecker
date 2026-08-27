import { NextResponse } from 'next/server';

type HpPart = Record<string, string | number | null | undefined>;
type HpSerialBom = {
  unit_configuration?: HpPart[];
  spare_part?: HpPart[];
  wwsnrsinput?: {
    product_no?: unknown;
    user_name?: unknown;
  };
  roHS_unit_status?: {
    rohs_status_code?: unknown;
  };
};
type HpPayload = {
  Body?: {
    SerialNumberBOM?: HpSerialBom;
  };
};
type RamSpec = {
  capacity: string;
  generation: string;
  speed: string;
  voltage: string;
  form: string;
  ecc: string;
};

const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

function describeCpu(unitParts: HpPart[], spareParts: HpPart[]) {
  const unit = unitParts.find((part) => {
    const partText = normalize(part.part_description);
    return !/heat\s?sink/i.test(partText) && /(i[3579]-\d{4,5}|xeon|ryzen|celeron|pentium)/i.test(partText);
  });
  if (!unit) {
    return {
      value: 'CPU not listed by HP (Review: serial configuration does not identify a processor)',
      source: 'not-listed',
      reason: 'HP does not identify a processor in the serial-specific configuration.',
    };
  }
  const unitText = normalize(unit.part_description);
  const model = unitText.match(/i[3579]-\d{4,5}|xeon\s+[a-z0-9-]+|ryzen\s+\d+\s+[a-z0-9-]+|celeron\s+[a-z0-9-]+|pentium\s+[a-z0-9-]+/i)?.[0] ?? unitText;
  const spareText = normalize(spareParts.find((part) => {
    const partText = normalize(part.spare_part_description);
    return partText.toLowerCase().includes(model.toLowerCase()) && /(cpu|processor)/i.test(partText) && !/heat\s?sink/i.test(partText);
  })?.spare_part_description);
  const details = `${unitText} ${spareText}`;
  const cores = details.match(/(?:^|\s)(\d{1,2})C(?:\s|$)/i)?.[1];
  const speed = details.match(/(\d+(?:\.\d+)?)\s*GHz/i)?.[1];
  const watts = details.match(/(\d{2,3})\s*W(?:\s|$)/i)?.[1];
  const brand = /^i[3579]-/i.test(model) ? `Intel Core ${model}` : model;
  return {
    value: [brand, cores ? `${cores} cores` : '', speed ? `${speed} GHz` : '', watts ? `${watts} W` : ''].filter(Boolean).join(', '),
    source: 'serial-bom',
    reason: '',
  };
}

function parseRam(value: string): RamSpec {
  return {
    capacity: value.match(/(\d+)\s*GB/i)?.[1] ?? '',
    generation: value.match(/DDR[345]/i)?.[0]?.toUpperCase() ?? '',
    speed: value.match(/DDR[345]-(\d+)/i)?.[1] ?? '',
    voltage: value.match(/\d+(?:\.\d+)?\s*[vV]/)?.[0] ?? '',
    form: value.match(/SODIMM|UDIMM/i)?.[0]?.toUpperCase() ?? '',
    ecc: /NECC|NON[- ]?ECC/i.test(value) ? 'non-ECC' : /\bECC\b/i.test(value) ? 'ECC' : '',
  };
}

function formatRam(spec: RamSpec) {
  const ddr = spec.generation ? `${spec.generation}${spec.speed ? `-${spec.speed}` : ''}` : '';
  return [spec.capacity ? `${spec.capacity} GB` : '', ddr, spec.voltage, spec.ecc, spec.form].filter(Boolean).join(', ');
}

function describeRam(unitParts: HpPart[], spareParts: HpPart[]) {
  const memoryPattern = /(\d+)\s*GB.*(?:DDR[345]|UDIMM|SODIMM)|(?:DDR[345]|UDIMM|SODIMM).*?(\d+)\s*GB/i;
  const unitCandidates = unique(unitParts.map((part) => normalize(part.part_description)).filter((partText) => memoryPattern.test(partText)));
  if (unitCandidates.length) {
    return {
      value: unique(unitCandidates.map((candidate) => formatRam(parseRam(candidate)))).join(' + '),
      source: 'serial-bom',
      candidates: unitCandidates,
      reason: '',
    };
  }

  const candidates = unique(spareParts.map((part) => normalize(part.spare_part_description)).filter((partText) => memoryPattern.test(partText)));
  if (!candidates.length) {
    return {
      value: 'RAM unavailable (Review: HP does not list installed or compatible memory)',
      source: 'not-listed',
      candidates,
      reason: 'HP does not list installed memory or a compatible RAM spare for this serial number.',
    };
  }
  if (candidates.length === 1) {
    return {
      value: formatRam(parseRam(candidates[0])),
      source: 'spare-bom',
      candidates,
      reason: 'RAM is inferred from the single compatible HP spare; the installed module is not shown in the serial-specific configuration.',
    };
  }

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
  return {
    value: `${sharedDetails} (Review: ${shortReason})`,
    source: 'spare-bom-review',
    candidates,
    reason,
  };
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
    ['operatingSystem', /\b(DPK|WINDOWS|WIN\s?10|WIN\s?11|FREEDOS|CHROME\s?OS)\b/i],
    ['power', /\b(P\/S|PSU|POWER SUPPLY|AC ADAPTER|POWER ADAPTER)\b/i],
    ['systemBoard', /\b(MBD|SYSTEM BOARD|MOTHERBOARD|MAINBOARD)\b/i],
    ['graphics', /\b(GPU|GRAPHICS|GEFORCE|RADEON|QUADRO|NVIDIA|INTEL UHD)\b/i],
    ['network', /\b(WLAN|WI-?FI|WIRELESS|BLUETOOTH|ETHERNET|LAN|NIC)\b/i],
    ['display', /\b(LCD|DISPLAY|PANEL|TOUCHSCREEN)\b/i],
    ['optical', /\b(ODD|DVD|CD-ROM|OPTICAL)\b/i],
    ['battery', /\b(BATTERY|BATT)\b/i],
    ['audio', /\b(AUDIO|SPEAKER|MICROPHONE)\b/i],
  ];
  const grouped: Record<string, string[]> = Object.fromEntries(categories.map(([name]) => [name, []]));
  const otherComponents: string[] = [];
  for (const part of hardware) {
    if (/(i[3579]-\d{4,5}|xeon|ryzen|celeron|pentium)/i.test(part.description)) continue;
    if (/(\d+)\s*GB.*(?:DDR[345]|UDIMM|SODIMM)|(?:DDR[345]|UDIMM|SODIMM).*?(\d+)\s*GB/i.test(part.description)) continue;
    const match = categories.find(([, pattern]) => pattern.test(part.description));
    if (match) grouped[match[0]].push(part.description);
    else otherComponents.push(part.description);
  }

  return {
    storage: unique(grouped.storage),
    operatingSystem: unique(grouped.operatingSystem),
    power: unique(grouped.power),
    systemBoard: unique(grouped.systemBoard),
    graphics: unique(grouped.graphics),
    network: unique(grouped.network),
    display: unique(grouped.display),
    optical: unique(grouped.optical),
    battery: unique(grouped.battery),
    audio: unique(grouped.audio),
    otherComponents: unique(otherComponents),
    buildId: metadata.get('IMG_BUILDID') ?? '',
    featureByte: metadata.get('IMG_FEATUREBYTE') ?? '',
    macAddress: metadata.get('MAC_ADDR1') ?? metadata.get('PCA_MAC1') ?? '',
    manufactureDate: metadata.get('MANUF_DATE') ?? '',
    uuid: [metadata.get('UUID_HALF1'), metadata.get('UUID_HALF2')].filter(Boolean).join(''),
    rohsStatus: normalize(serialBom?.roHS_unit_status?.rohs_status_code),
    configurationItems: hardware,
    sparePartCount: spareParts.length,
  };
}

export async function POST(request: Request) {
  try {
    const { serial } = await request.json() as { serial?: string };
    const cleanSerial = normalize(serial).toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(cleanSerial)) {
      return NextResponse.json({ error: 'Invalid serial number' }, { status: 400 });
    }
    const input = `/SerialNumber/GetSerialNumber/${encodeURIComponent(cleanSerial)}/country/US/usertype/EXT`;
    const response = await fetch(`https://partsurfer.hpcloud.hp.com/bff/proxy/get?input=${input}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://partsurfer.hp.com',
        Referer: 'https://partsurfer.hp.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`HP lookup returned ${response.status}`);
    const payload = await response.json() as HpPayload;
    const serialBom = payload?.Body?.SerialNumberBOM ?? {};
    const unitParts = (serialBom?.unit_configuration ?? []) as HpPart[];
    const spareParts = (serialBom?.spare_part ?? []) as HpPart[];
    const cpu = describeCpu(unitParts, spareParts);
    const ram = describeRam(unitParts, spareParts);
    const identity = serialBom?.wwsnrsinput ?? {};
    const reasons = unique([cpu.reason, ram.source === 'spare-bom-review' || ram.source === 'not-listed' ? ram.reason : '']);
    return NextResponse.json({
      serial: cleanSerial,
      productNumber: normalize(identity.product_no),
      productName: normalize(identity.user_name),
      cpu: cpu.value,
      ram: ram.value,
      cpuSource: cpu.source,
      ramSource: ram.source,
      ramCandidates: ram.candidates ?? [],
      reviewReason: reasons.join(' '),
      moreInfo: buildMoreInfo(unitParts, spareParts, serialBom),
      found: Boolean(unitParts.length || spareParts.length || identity.product_no),
      sourceUrl: `https://partsurfer.hp.com/?searchtext=${encodeURIComponent(cleanSerial)}&searchby=swp`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, { status: 502 });
  }
}
