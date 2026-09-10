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
  username?: string;
  department?: string;
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

export type PrimaryResultRow = Pick<SpecResultRow,
  "Role" | "SerialNumber" | "ValidationStatus" | "SourceSheet" | "SourceRow"
> & Record<string, ExportCell>;

export type ReviewResultRow = Record<string, ExportCell> & {
  Role: string;
  SerialNumber: string;
  ValidationStatus: string;
  RecommendedAction: string;
};

export type EvidenceResultRow = Pick<SpecResultRow,
  "Role" | "SerialNumber" | "SourceSheet" | "SourceRow"
> & Record<string, ExportCell>;

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
      Username: device.username ?? "",
      Department: device.department ?? "",
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

export function buildPrimaryResultRows(devices: ExportDevice[]): PrimaryResultRow[] {
  return buildSpecResultRows(devices).map((row) => ({
    Role: row.Role,
    SerialNumber: row.SerialNumber,
    SourceModel: row.SourceModel,
    HPProductNumber: row.HPProductNumber,
    HPProductName: row.HPProductName,
    Username: row.Username,
    Department: row.Department,
    CPU: row.CPU,
    RAM: row.RAM,
    ValidationStatus: row.ValidationStatus,
    Storage: row.Storage,
    Graphics: row.Graphics,
    Display: row.Display,
    Battery: row.Battery,
    Network: row.Network,
    Power: row.Power,
    Keyboard: row.Keyboard,
    SystemBoard: row.SystemBoard,
    OperatingSystem: row.OperatingSystem,
    ReviewReason: row.ReviewReason,
    SourceSheet: row.SourceSheet,
    SourceRow: row.SourceRow,
    HPSource: row.HPSource,
  }));
}

export function buildReviewRows(devices: ExportDevice[]): ReviewResultRow[] {
  return buildSpecResultRows(devices)
    .filter((row) => row.ValidationStatus !== "VERIFIED")
    .map((row) => ({
      Role: row.Role,
      SerialNumber: row.SerialNumber,
      SourceModel: row.SourceModel,
      HPProductNumber: row.HPProductNumber,
      HPProductName: row.HPProductName,
      Username: row.Username,
      Department: row.Department,
      CPU: row.CPU,
      RAM: row.RAM,
      ValidationStatus: row.ValidationStatus,
      ReviewReason: row.ReviewReason,
      RecommendedAction: row.ValidationStatus === "UNRESOLVED"
        ? "Retry the lookup; if HP still returns no result, verify the serial and inspect the device manually."
        : "Open the HP source and compare product candidates and field evidence before sharing with a customer.",
      CandidateProducts: row.CandidateProducts,
      HPSource: row.HPSource,
    }));
}

export function buildEvidenceRows(devices: ExportDevice[]): EvidenceResultRow[] {
  return buildSpecResultRows(devices).map((row) => ({
    Role: row.Role,
    SerialNumber: row.SerialNumber,
    SourceSheet: row.SourceSheet,
    SourceRow: row.SourceRow,
    SourceModel: row.SourceModel,
    SourceProductNumber: row.SourceProductNumber,
    SourceAsset: row.SourceAsset,
    HPProductNumber: row.HPProductNumber,
    HPProductName: row.HPProductName,
    Username: row.Username,
    Department: row.Department,
    ValidationStatus: row.ValidationStatus,
    ReviewReason: row.ReviewReason,
    MatchMethod: row.MatchMethod,
    CandidateCount: row.CandidateCount,
    CandidateProducts: row.CandidateProducts,
    CPUDescriptionEvidence: row.CPUDescriptionEvidence,
    RAMDescriptionEvidence: row.RAMDescriptionEvidence,
    EvidencePartNumbers: row.EvidencePartNumbers,
    EvidenceDescriptions: row.EvidenceDescriptions,
    Optical: row.Optical,
    Audio: row.Audio,
    OtherSpecifications: row.OtherSpecifications,
    LookupCountry: row.LookupCountry,
    LookupTime: row.LookupTime,
    HPSource: row.HPSource,
  }));
}
