import type { EvidenceType, HpRawPart, Specification, SpecificationEvidence } from "./types";

const CPU_PATTERN = /\b(?:core\s+ultra\s+[3579]\s+\d{3}[a-z]{0,2}|i[3579]-\d{4,5}[a-z]{0,3}|xeon(?:\s+[a-z0-9-]+){1,3}|ryzen(?:\s+ai)?\s+\d+(?:\s+pro)?(?:\s+[a-z0-9-]+){0,2}|celeron(?:\s+[a-z0-9-]+){1,2}|pentium(?:\s+[a-z0-9-]+){1,2})\b/i;
const MEMORY_PATTERN = /(\d+)\s*GB.*(?:DDR[345]|LPDDR[345X]*|UDIMM|SODIMM)|(?:DDR[345]|LPDDR[345X]*|UDIMM|SODIMM).*?(\d+)\s*GB/i;

const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["storage", /\b(HDD|SSD|NVME|M\.?2|EMMC|HARD DRIVE|SOLID STATE)\b/i],
  ["graphics", /\b(GPU|GRAPHICS|GEFORCE|RADEON|QUADRO|NVIDIA|INTEL UHD|INTEL IRIS)\b/i],
  ["display", /\b(LCD|DISPLAY|PANEL|TOUCHSCREEN)\b/i],
  ["battery", /\b(BATTERY|BATT)\b/i],
  ["network", /\b(WLAN|WI-?FI|WIRELESS|BLUETOOTH|ETHERNET|LAN|NIC)\b/i],
  ["power", /\b(P\/S|PSU|POWER SUPPLY|AC ADAPTER|POWER ADAPTER|ADAPTER)\b/i],
  ["keyboard", /\b(KEYBOARD|KBD|TOP COVER.*KB|KB.*TOP COVER)\b/i],
  ["systemBoard", /\b(MBD|SYSTEM BOARD|MOTHERBOARD|MAINBOARD)\b/i],
  ["operatingSystem", /\b(DPK|WINDOWS|WIN\s?10|WIN\s?11|FREEDOS|CHROME\s?OS)\b/i],
  ["optical", /\b(ODD|DVD|CD-ROM|OPTICAL)\b/i],
  ["audio", /\b(AUDIO|SPEAKER|MICROPHONE)\b/i],
];

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function evidence(part: HpRawPart, type: EvidenceType): SpecificationEvidence {
  const spare = type === "compatible-spare";
  return {
    hpDescription: clean(spare ? part.spare_part_description : part.part_description),
    hpPartNumber: clean(spare ? part.spare_part_number : part.part_number),
    quantity: clean(part.quantity),
    evidenceType: type,
    serialSpecific: type === "serial-bom",
  };
}

function ramValue(description: string): string {
  const capacity = description.match(/(\d+)\s*GB/i)?.[1];
  const generation = description.match(/LPDDR[345X]*|DDR[345]/i)?.[0]?.toUpperCase();
  const speed = description.match(/(?:LPDDR[345X]*|DDR[345])[- ](\d{3,5})/i)?.[1];
  const voltage = description.match(/\d+(?:\.\d+)?\s*[vV]/)?.[0];
  const form = description.match(/SODIMM|UDIMM/i)?.[0]?.toUpperCase();
  const ecc = /NECC|NON[- ]?ECC/i.test(description) ? "non-ECC" : /\bECC\b/i.test(description) ? "ECC" : "";
  return [capacity ? `${capacity} GB` : "", generation ? `${generation}${speed ? `-${speed}` : ""}` : "", voltage, ecc, form].filter(Boolean).join(", ");
}

function cpuValue(description: string): string {
  const model = description.match(CPU_PATTERN)?.[0] ?? description;
  const brand = /^i[3579]-/i.test(model) ? `Intel Core ${model}` : /^core\s+ultra/i.test(model) ? `Intel ${model}` : model;
  const cores = description.match(/(?:^|\s)(\d{1,2})C(?:\s|$)/i)?.[1];
  const speed = description.match(/(\d+(?:\.\d+)?)\s*GHz/i)?.[1];
  const watts = description.match(/(\d{2,3})\s*W(?:\s|$)/i)?.[1];
  return [brand, cores ? `${cores} cores` : "", speed ? `${speed} GHz` : "", watts ? `${watts} W` : ""].filter(Boolean).join(", ");
}

function specification(field: string, normalizedValue: string, items: SpecificationEvidence[], reviewReason?: string): Specification {
  const first = items[0];
  return {
    category: field,
    field,
    normalizedValue,
    hpDescription: first?.hpDescription ?? "",
    hpPartNumber: first?.hpPartNumber ?? "",
    evidenceType: first?.evidenceType ?? "inferred",
    serialSpecific: items.length > 0 && items.every((item) => item.serialSpecific),
    evidence: items,
    reviewReason,
  };
}

export function parseSpecifications(input: {
  unitConfiguration: HpRawPart[];
  spareParts: HpRawPart[];
}): Specification[] {
  const specs: Specification[] = [];
  const unit = input.unitConfiguration.filter((part) => clean(part.part_description) && clean(part.part_description) !== "-N/A-");

  const cpuPart = unit.find((part) => {
    const description = clean(part.part_description);
    return !/heat\s?sink|thermal/i.test(description) && CPU_PATTERN.test(description);
  });
  if (cpuPart) {
    const item = evidence(cpuPart, "serial-bom");
    specs.push(specification("cpu", cpuValue(item.hpDescription), [item]));
  }

  const installedRam = unit.filter((part) => MEMORY_PATTERN.test(clean(part.part_description)));
  if (installedRam.length) {
    const items = installedRam.map((part) => evidence(part, "serial-bom"));
    const values = unique(items.map((item) => ramValue(item.hpDescription)).filter(Boolean));
    specs.push(specification("ram", values.join(" + "), items));
  } else {
    const spareRam = input.spareParts.filter((part) => MEMORY_PATTERN.test(clean(part.spare_part_description)));
    if (spareRam.length) {
      const items = spareRam.map((part) => evidence(part, "compatible-spare"));
      const values = unique(items.map((item) => ramValue(item.hpDescription)).filter(Boolean));
      const summary = values.length === 1 ? values[0] : `${values.join(" / ")} (Review: multiple compatible HP RAM spares)`;
      specs.push(specification(
        "ram",
        values.length === 1 ? `${summary} (Review: compatible spare; installed RAM not confirmed)` : summary,
        items,
        "HP lists compatible RAM spare parts, but the serial-specific configuration does not confirm the installed module.",
      ));
    }
  }

  for (const part of unit) {
    const item = evidence(part, "serial-bom");
    if (part === cpuPart || installedRam.includes(part) || !item.hpDescription) continue;
    const match = CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(item.hpDescription));
    const category = match?.[0] ?? "otherComponents";
    specs.push(specification(category, item.hpDescription, [item]));
  }

  return specs;
}
