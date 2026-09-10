import type { HpProductCandidate, HpRawPart } from "./types";

type Bom = {
  unit_configuration?: HpRawPart[];
  spare_part?: HpRawPart[];
  wwsnrsinput?: Record<string, unknown>;
};

type ProductListItem = {
  product_Id?: unknown;
  product_Desc?: unknown;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isBom(value: unknown): value is Bom {
  return Boolean(value && typeof value === "object");
}

export function extractProductCandidates(payload: unknown, requestedSerial: string): HpProductCandidate[] {
  const body = (payload as { Body?: Record<string, unknown> } | undefined)?.Body ?? {};
  const possible = [body.SerialNumberBOM, body.SerialNumberBOMs]
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .filter(isBom);

  const bomCandidates = possible.map((bom) => {
    const identity = bom.wwsnrsinput ?? {};
    return {
      productNumber: clean(identity.product_no ?? identity.product_number),
      productName: clean(identity.user_name ?? identity.product_name ?? identity.model_name),
      serialNumber: clean(identity.serial_number ?? identity.serial_no) || (possible.length === 1 ? requestedSerial : ""),
      unitConfiguration: Array.isArray(bom.unit_configuration) ? bom.unit_configuration : [],
      spareParts: Array.isArray(bom.spare_part) ? bom.spare_part : [],
    };
  });

  const productList = Array.isArray(body.SNRProductLists) ? body.SNRProductLists : [];
  const selectionCandidates = productList.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as ProductListItem;
    const productNumber = clean(item.product_Id);
    if (!productNumber) return [];
    return [{
      productNumber,
      productName: clean(item.product_Desc),
      serialNumber: requestedSerial,
      unitConfiguration: [],
      spareParts: [],
    }];
  });

  return [...bomCandidates, ...selectionCandidates];
}
