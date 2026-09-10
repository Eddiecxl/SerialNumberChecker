import type { HpProductCandidate, ProductHints, ProductResolution } from "./types";

function key(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function choose(
  matches: HpProductCandidate[],
  candidates: HpProductCandidate[],
  matchMethod: ProductResolution["matchMethod"],
  reason: string,
): ProductResolution | undefined {
  if (matches.length !== 1) return undefined;
  return { status: "VERIFIED", selected: matches[0], candidates, matchMethod, reason };
}

export function resolveProduct(
  candidates: HpProductCandidate[],
  hints: ProductHints,
): ProductResolution {
  if (!candidates.length) {
    return { status: "UNRESOLVED", candidates, matchMethod: "not-found", reason: "HP did not return a product candidate for this serial number." };
  }

  if (hints.productNumberHint) {
    const result = choose(
      candidates.filter((candidate) => key(candidate.productNumber) === key(hints.productNumberHint)),
      candidates,
      "product-number",
      "Exact workbook product number matched an HP candidate.",
    );
    if (result) return result;
  }

  const serialResult = choose(
    candidates.filter((candidate) => candidate.serialNumber && key(candidate.serialNumber) === key(hints.serial)),
    candidates,
    "serial-identity",
    "HP returned this candidate for the requested serial identity.",
  );
  if (serialResult) return serialResult;

  if (hints.modelHint) {
    const modelResult = choose(
      candidates.filter((candidate) => key(candidate.productName) === key(hints.modelHint)),
      candidates,
      "model-exact",
      "Exact normalized workbook model matched an HP candidate.",
    );
    if (modelResult) return modelResult;
  }

  if (candidates.length === 1) {
    return {
      status: "VERIFIED",
      selected: candidates[0],
      candidates,
      matchMethod: "unique-candidate",
      reason: "HP returned one unique product candidate.",
    };
  }

  return {
    status: "REVIEW REQUIRED",
    candidates,
    matchMethod: "ambiguous",
    reason: `HP returned ${candidates.length} candidates and the workbook hints did not identify one exactly.`,
  };
}
