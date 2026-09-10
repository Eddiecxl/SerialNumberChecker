export type ValidationStatus = "VERIFIED" | "REVIEW REQUIRED" | "UNRESOLVED";
export type EvidenceType = "serial-bom" | "product-bom" | "compatible-spare" | "inferred";

export type HpRawPart = Record<string, string | number | null | undefined>;

export interface HpProductCandidate {
  productNumber: string;
  productName: string;
  serialNumber?: string;
  unitConfiguration: HpRawPart[];
  spareParts: HpRawPart[];
}

export interface ProductHints {
  serial: string;
  productNumberHint?: string;
  modelHint?: string;
}

export interface ProductResolution {
  status: ValidationStatus;
  selected?: HpProductCandidate;
  candidates: HpProductCandidate[];
  matchMethod: "product-number" | "serial-identity" | "model-exact" | "model-signature" | "unique-candidate" | "ambiguous" | "not-found";
  reason: string;
}

export interface SpecificationEvidence {
  hpDescription: string;
  hpPartNumber: string;
  quantity: string;
  evidenceType: EvidenceType;
  serialSpecific: boolean;
}

export interface Specification {
  category: string;
  field: string;
  normalizedValue: string;
  hpDescription: string;
  hpPartNumber: string;
  evidenceType: EvidenceType;
  serialSpecific: boolean;
  evidence: SpecificationEvidence[];
  reviewReason?: string;
}

export interface DeviceValidation {
  status: ValidationStatus;
  reason: string;
  checks: Array<{ key: string; label: string; status: "pass" | "review" | "fail"; detail: string }>;
}
