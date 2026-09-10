interface GroupedRecord {
  sourceGroupKey: string;
}

interface EvidenceSpecification {
  field: string;
  normalizedValue: string;
  evidence: Array<{
    hpDescription: string;
    hpPartNumber: string;
    quantity?: string;
    evidenceType: string;
    serialSpecific: boolean;
  }>;
}

export function groupStartIndexes(records: GroupedRecord[]): Set<number> {
  return new Set(records.flatMap((record, index) => (
    index === 0 || records[index - 1].sourceGroupKey !== record.sourceGroupKey ? [index] : []
  )));
}

export function buildEvidenceRows(specifications: EvidenceSpecification[]) {
  return specifications.flatMap((specification) => specification.evidence
    .filter((item) => item.hpDescription || item.hpPartNumber)
    .map((item) => ({
      field: specification.field.toUpperCase(),
      value: specification.normalizedValue,
      description: item.hpDescription,
      partNumber: item.hpPartNumber,
      evidenceType: item.evidenceType,
      serialSpecific: item.serialSpecific,
    })));
}
