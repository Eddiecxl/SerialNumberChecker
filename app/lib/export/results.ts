export type ExportCell = string | number | boolean;

interface ExportSpecification {
  category: string;
  field: string;
  normalizedValue: string;
  hpDescription: string;
  hpPartNumber: string;
  evidenceType: string;
  serialSpecific: boolean;
  evidence: Array<{ hpDescription: string; hpPartNumber: string; quantity: string; evidenceType: string; serialSpecific: boolean }>;
}

export interface ExportDevice {
  sourceSheet?: string;
  sheetName?: string;
  sourceRow?: number;
  rowNumber?: number;
  role: string;
  serialNumber: string;
  modelHint?: string;
  productNumberHint?: string;
  asset?: string;
  description?: string;
  productNumber?: string;
  productName?: string;
  cpu?: string;
  ram?: string;
  validationStatus: string;
  reviewReason?: string;
  resolution?: { matchMethod: string; reason: string; candidateCount: number; candidates: Array<{ productNumber: string; productName: string; serialNumber: string }> };
  specifications?: ExportSpecification[];
  cpuEvidence?: string[];
  ramEvidence?: string[];
  sourceUrl?: string;
  lookupCountry?: string;
  lookedUpAt?: string;
}

export type SpecResultRow = Record<string, ExportCell> & {
  SourceSheet: string;
  SourceRow: number;
  Role: string;
  SerialNumber: string;
  ValidationStatus: string;
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function validationLabel(value: string): "VERIFIED" | "REVIEW REQUIRED" | "UNRESOLVED" {
  if (value === "supported" || value === "VERIFIED") return "VERIFIED";
  if (value === "unavailable" || value === "UNRESOLVED") return "UNRESOLVED";
  return "REVIEW REQUIRED";
}

function category(specifications: ExportSpecification[], name: string): string {
  return unique(specifications.filter((spec) => spec.category === name).map((spec) => spec.normalizedValue)).join(" | ");
}

export function buildSpecResultRows(devices: ExportDevice[]): SpecResultRow[] {
  return devices.map((device) => {
    const specs = device.specifications ?? [];
    const evidence = specs.flatMap((spec) => spec.evidence ?? []);
    const knownCategories = new Set(["cpu", "ram", "storage", "graphics", "display", "battery", "network", "power", "keyboard", "systemBoard", "operatingSystem", "optical", "audio"]);
    const other = specs.filter((spec) => !knownCategories.has(spec.category)).map((spec) => spec.normalizedValue);
    return {
      SourceSheet: device.sourceSheet ?? device.sheetName ?? "",
      SourceRow: device.sourceRow ?? device.rowNumber ?? 0,
      Role: device.role,
      SerialNumber: device.serialNumber,
      SourceModel: device.modelHint ?? device.description ?? "",
      SourceProductNumber: device.productNumberHint ?? "",
      SourceAsset: device.asset ?? "",
      HPProductNumber: device.productNumber ?? "",
      HPProductName: device.productName ?? "",
      CPU: device.cpu ?? "",
      RAM: device.ram ?? "",
      ValidationStatus: validationLabel(device.validationStatus),
      ReviewReason: device.reviewReason ?? "",
      MatchMethod: device.resolution?.matchMethod ?? "",
      CandidateCount: device.resolution?.candidateCount ?? 0,
      CandidateProducts: (device.resolution?.candidates ?? []).map((item) => `${item.productNumber}: ${item.productName}`).join(" | "),
      Storage: category(specs, "storage"),
      Graphics: category(specs, "graphics"),
      Display: category(specs, "display"),
      Battery: category(specs, "battery"),
      Network: category(specs, "network"),
      Power: category(specs, "power"),
      Keyboard: category(specs, "keyboard"),
      SystemBoard: category(specs, "systemBoard"),
      OperatingSystem: category(specs, "operatingSystem"),
      Optical: category(specs, "optical"),
      Audio: category(specs, "audio"),
      OtherSpecifications: unique(other).join(" | "),
      CPUDescriptionEvidence: unique(device.cpuEvidence ?? []).join(" | "),
      RAMDescriptionEvidence: unique(device.ramEvidence ?? []).join(" | "),
      EvidencePartNumbers: unique(evidence.map((item) => item.hpPartNumber)).join(" | "),
      EvidenceDescriptions: unique(evidence.map((item) => item.hpDescription)).join(" | "),
      LookupCountry: device.lookupCountry ?? "",
      LookupTime: device.lookedUpAt ?? "",
      HPSource: device.sourceUrl ?? "",
    };
  });
}

export function buildReviewRows(devices: ExportDevice[]): Array<SpecResultRow & { RecommendedAction: string }> {
  return buildSpecResultRows(devices)
    .filter((row) => row.ValidationStatus !== "VERIFIED")
    .map((row) => ({
      ...row,
      RecommendedAction: row.ValidationStatus === "UNRESOLVED"
        ? "Retry the lookup; if HP still returns no result, verify the serial and inspect the device manually."
        : "Open the HP source and compare product candidates and field evidence before sharing with a customer.",
    }));
}
