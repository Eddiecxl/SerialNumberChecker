import JSZip from "jszip";

const CONTENT_TYPES_PATH = "[Content_Types].xml";
const WORKSHEET_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

export async function ensureWorksheetContentTypes(input: Blob | ArrayBuffer): Promise<Blob> {
  const zip = await JSZip.loadAsync(input);
  const contentTypesFile = zip.file(CONTENT_TYPES_PATH);
  if (!contentTypesFile) throw new Error("Excel package is missing [Content_Types].xml");

  let contentTypes = await contentTypesFile.async("string");
  const worksheetPaths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const missingOverrides = worksheetPaths
    .map((path) => `/${path}`)
    .filter((partName) => !contentTypes.includes(`PartName="${partName}"`))
    .map((partName) => `<Override PartName="${partName}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`)
    .join("");

  if (missingOverrides) {
    contentTypes = contentTypes.replace("</Types>", `${missingOverrides}</Types>`);
    zip.file(CONTENT_TYPES_PATH, contentTypes);
  }

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}
