# Universal HP Serial Checker — Design Specification

**Date:** 2026-09-10  
**Status:** Approved architecture, pending implementation-plan approval  
**Product:** CTC HP Serial Spec Checker

## 1. Purpose

Upgrade the current HP Serial Spec Checker from a template-oriented workbook tool into a production-quality business application that can understand varied Excel layouts, retrieve and validate HP device specifications, present traceable evidence, and export complete results without changing the original worksheets.

The primary business requirement remains fast and dependable CPU and RAM lookup. The same lookup run will also collect all other available HP component information for a separate detailed view and export.

## 2. Current State and Compatibility

The existing application already provides workbook upload, HP PartSurfer lookup, CPU/RAM results, more-information and validation pages, and Excel export. Its current parser scans a limited header area and selects only the first recognized serial-number column on a sheet. This works for the original `Appendix 3A.xlsx` structure but misses layouts with multiple device roles, such as the supplied collection listing containing both `NewSerialNumber` and `OldSerialNumber`.

The upgrade will preserve:

- The CTC visual identity, Malaysia HP PartSurfer country selection, and existing navigation concepts.
- Support for the original Appendix 3A workbook and its CPU/RAM workflow.
- Existing valid CPU, RAM, spare-part inference, and broader component extraction behavior, while making evidence and validation more explicit.
- Browser-based workbook handling so source files do not need to be uploaded to a separate document-processing service.

## 3. Goals

1. Detect one or many serial-number columns on any relevant sheet, regardless of column order, header row, title rows, merged headings, or reasonable wording differences.
2. Associate each serial column with nearby model, product/SKU, device-type, asset, and role information.
3. Use deterministic rules first and Groq AI only once when the workbook structure is genuinely ambiguous.
4. Resolve HP product candidates without guessing and record how every match was made.
5. Show CPU and RAM prominently, show all other available specifications separately, and expose evidence suitable for customer-facing validation.
6. Export the original workbook content unchanged plus normalized result and review worksheets.
7. Process large batches safely with deduplication, controlled concurrency, retries, progress, pause/resume, and per-device retry.

## 4. Non-Goals

- AI will not identify hardware specifications or choose between uncertain HP products.
- The application will not claim that a compatible spare part was factory-installed.
- The application will not modify, reorder, delete, or overwrite the source worksheets.
- The first release will not provide authoritative coverage for non-HP devices or non-HP data sources.
- A failed Groq request must not prevent manual mapping or deterministic processing.

## 5. Architecture and Data Flow

The application remains a browser-first Next.js/Cloudflare Worker application, but responsibilities will be separated into testable modules.

1. **Workbook inspection:** Read each worksheet locally in the browser and build a compact structural profile: sheet dimensions, merged ranges, candidate header rows, column headers, value patterns, and representative masked samples.
2. **Deterministic detection:** Score every plausible serial column and its related hint columns. A sheet may produce zero, one, or many device-role mappings.
3. **Confirmation/fallback:** Auto-accept high-confidence mappings. Present uncertain mappings to the user. Groq may suggest a mapping from sanitized structure only; its response is validated against the actual workbook before it can be accepted.
4. **Normalization:** Convert mapped workbook cells into independent device records while retaining source sheet, row, column, role, and hint provenance.
5. **Lookup queue:** Deduplicate serials, schedule controlled HP lookups, retry transient failures with backoff, and fan one response back out to every source occurrence.
6. **HP resolution and parsing:** Resolve zero, one, or multiple HP product candidates using deterministic priorities. Parse component rows into normalized fields with original evidence.
7. **Validation:** Assign `VERIFIED`, `REVIEW REQUIRED`, or `UNRESOLVED` based on evidence strength and unresolved conflicts.
8. **Presentation/export:** Render grouped and normalized results, provide filters and evidence, and create added worksheets without altering the source sheets.

Planned boundaries include workbook detection/normalization, Groq layout resolution, HP product resolution/spec parsing, validation, queue control, and export services. UI components will be extracted from the current large page where practical, without an unnecessary full rewrite.

## 6. Normalized Data Model

Each physical or logical device becomes a separate normalized record:

```text
DeviceRecord
  id
  serialNumber
  normalizedSerial
  role                  // e.g. New, Old, Replacement, Primary
  sourceSheet
  sourceRow
  serialColumn
  sourceGroupKey        // groups devices from the same original row
  modelHint
  productNumberHint
  deviceTypeHint
  assetHint
  lookupStatus
  resolution
  specifications[]
  validation
  timestamps
```

Each specification preserves both the useful value and its evidence:

```text
Specification
  category
  field
  normalizedValue
  hpDescription
  hpPartNumber
  evidenceType          // serial BOM, product BOM, compatible spare, inferred
  serialSpecific
  sourceUrl
```

This model allows two devices from the same workbook row to be processed and exported independently while remaining visibly grouped.

## 7. Deterministic Workbook Detection

Detection will evaluate multiple candidate header rows per sheet instead of assuming the first row or first matching column. Scoring signals include:

- Header aliases and token similarity for serial, serial number, S/N, service tag, old/new serial, and related wording.
- Serial-like value density below the candidate header.
- Uniqueness, non-empty density, value lengths, and rejection of obvious date/quantity/price columns.
- Nearby semantic hints such as model, product number, SKU, device type, asset, CPU, and RAM.
- Multi-level or merged headings, including role headings such as New and Old.
- Repeated table blocks and multiple serial columns on one sheet.

A mapping may be auto-accepted only when its confidence is high and it has a clear lead over competing interpretations. Initial thresholds will be calibrated by tests, with an intended auto-accept confidence around 0.85. Otherwise, the mapping screen will show detected sheets, header row, serial columns, roles, related hint columns, confidence, and warnings for user confirmation or correction.

All accepted mappings are validated against real column bounds and cell patterns. Empty and duplicate serials are tracked rather than silently discarded.

## 8. Groq AI Fallback

Groq is a structure-understanding fallback, not part of normal lookup. The default model is `openai/gpt-oss-20b`, configurable through `GROQ_LAYOUT_MODEL`.

- Expected calls: zero for clear workbooks; normally one for an ambiguous workbook.
- The browser sends a compact structural profile to a backend route. Personal names and cell values unrelated to structure are omitted. Serial samples are masked; only shape information such as length and character class is retained.
- The response must match a strict JSON schema identifying sheet, header row, serial columns, roles, and optional related hint columns.
- The server and client validate that every suggested sheet, row, and column exists and that proposed serial columns contain serial-like data.
- AI output is always labeled as a suggestion. If confidence remains low, the user must confirm the mapping.
- If the key is missing, the API is unavailable, or output is invalid, the app explains the issue and continues with manual mapping.

`GROQ_API_KEY` exists only as a Cloudflare secret and is never bundled into the browser or exported workbook.

## 9. HP PartSurfer Resolution

The lookup route will continue using the Malaysia PartSurfer context and will support zero, one, or multiple candidate products.

Candidate selection priority is:

1. Exact product-number/SKU hint match.
2. Candidate explicitly returned for the requested HP serial identity.
3. Exact normalized model match.
4. A single remaining candidate after deterministic filtering.
5. Otherwise, no automatic selection; mark `REVIEW REQUIRED` and show candidates.

The application must not use AI or fuzzy guesswork to break unresolved product ties. Product identifiers, model, serial association, match method, requested URL, response timestamp, and candidate list are retained as validation evidence.

Component parsing will cover all useful PartSurfer BOM descriptions, including CPU, memory, storage, GPU, display/panel, battery, WLAN/LAN, AC adapter/power, keyboard, system board, operating system, optical drive, audio, and other parts. Each result keeps its normalized value, original HP description, and HP part number.

RAM handling must distinguish installed configuration from compatible spare evidence. If multiple DDR modules or capacities appear only as compatible service parts, the app lists the evidence and marks the installed RAM as needing review instead of leaving it blank or presenting an unsupported total.

## 10. Validation and Evidence

Validation is evidence-based:

- **VERIFIED:** the serial is associated with a resolved HP product and the reported field is supported by serial-specific configuration/BOM evidence without material conflict.
- **REVIEW REQUIRED:** a plausible result exists but depends on product-level/compatible-spare evidence, has multiple possible products or component values, conflicts with workbook hints, or cannot prove installed quantity/configuration.
- **UNRESOLVED:** HP returns no usable product, the lookup fails after retries, or no supported value can be found.

The evidence view will show:

- Serial and resolved product/model identity.
- Match method and candidate count.
- Field-level HP descriptions and part numbers.
- Whether evidence is serial-specific, product-generic, compatible-spare, or inferred.
- Lookup time, source URL, and any conflict/review reason.

This makes verification auditable: users can compare the displayed interpretation to the exact HP descriptions and open the corresponding HP source page. The app validates extraction consistency, but only HP serial-specific records can establish the factory configuration with high confidence.

## 11. User Experience

The existing high-class CTC navy/blue/teal design will be refined for readability and business use.

- **Import and mapping:** upload summary, detected device roles, confidence, warnings, and an editable confirmation table when required.
- **CPU & RAM:** primary operational view with larger typography, clear statuses, row grouping, search, filters, progress, retry, pause/resume, and copy-friendly values.
- **More Info:** all other normalized component groups, with expandable detail that does not create blank table regions or hover collisions.
- **Validation:** concise evidence checks, reasons, candidate conflicts, and links to HP sources.
- **Fields:** configurable visibility for available normalized fields; adding a parser field should not require redesigning the table.
- **Source:** source occurrence and mapping traceability.

Two result presentations are required:

1. A grouped view that mirrors the original row relationship, such as New device and Old device together.
2. A normalized table with one row per device for filtering, lookup status, evidence, and export review.

## 12. Export Contract

Export creates a new `.xlsx` file and never mutates the uploaded file in place.

- Every original worksheet is copied with its original cells and layout preserved as closely as the workbook library permits.
- Add **Spec Results**, one row per normalized device, containing source location, role, serial, source hints, resolved HP identity, CPU, RAM, validation status/reason, all available normalized fields, evidence summary, source link, and timestamp.
- Add **Review Required**, containing only devices or fields that require action, candidate choices, conflicts, failures, and recommended review steps.
- The supplied collection workbook should produce 430 result rows: 215 New devices and 215 Old devices.
- The original Appendix 3A workbook remains supported, even though its serial and result columns differ from the new workbook.

## 13. Reliability and Performance

- Bounded lookup concurrency with a conservative default.
- Exponential backoff with jitter for transient HTTP failures and rate limits.
- Per-request timeout and actionable error classes.
- Per-run normalized-serial deduplication; duplicate workbook occurrences reuse one response.
- Session cache for completed results, with a user-controlled fresh retry.
- Pause/resume stops new work while allowing in-flight requests to settle.
- One failed serial never cancels the batch.
- Progress reports total devices, unique requests, completed, verified, review, unresolved, duplicates reused, and retries.

No background global state will hold request-specific results in the Worker. Secrets remain in bindings, promises are awaited, and upstream response bodies/errors are handled safely.

## 14. Security and Privacy

- Excel parsing and export occur locally in the browser.
- Only device lookup inputs are sent to HP.
- Groq receives masked structural metadata only when deterministic detection is ambiguous.
- No employee/user names, departments, or unrelated workbook rows are included in AI prompts.
- Server logs must not record workbook contents or secret values.
- Source links and exported evidence exclude credentials.

## 15. Test and Acceptance Strategy

Automated tests will cover pure detection, normalization, resolution, parsing, validation, and export behavior. Integration tests will use fixtures and mocked HP/Groq responses rather than repeatedly calling live HP services.

Required cases include:

1. Original Appendix 3A layout.
2. Supplied New/Old collection layout producing 430 devices.
3. Three serial columns with distinct roles.
4. Serial columns in arbitrary order.
5. Title rows before the header.
6. Multi-row and merged headers.
7. Multiple relevant worksheets.
8. Alternate serial/model/product header wording.
9. Duplicate serials across rows and sheets.
10. Empty, malformed, and mixed serial cells.
11. Ambiguous layout using one sanitized Groq suggestion.
12. Groq unavailable or invalid, falling back to manual mapping.
13. HP zero, one, and multiple-product responses with deterministic selection/review.
14. RAM with serial-BOM evidence, spare-only evidence, conflicting modules, and no evidence.

Release acceptance also requires type/lint checks, production build, export inspection, responsive UI review, and a smoke test against a small live HP sample. Live-source variability must not make the automated suite flaky.

## 16. Configuration and Deployment

Required only for AI fallback:

- `GROQ_API_KEY`: Cloudflare secret.
- `GROQ_LAYOUT_MODEL`: optional environment variable; defaults to `openai/gpt-oss-20b`.

The application works without Groq through deterministic detection and manual confirmation. GitHub remains the source of truth. After implementation, tests, and production verification pass, the release will be committed and pushed to the configured repository. The Cloudflare Git integration must build the production branch automatically; the resulting deployment will then be smoke-tested on the live Worker URL.

## 17. Delivery Sequence

1. Add normalized types and deterministic workbook detector with fixtures/tests.
2. Add mapping confirmation and privacy-safe Groq fallback.
3. Refactor HP candidate resolution, parsing, evidence, and validation with mocked tests.
4. Add resilient queue controls and result state.
5. Refine the UI across CPU/RAM, More Info, Validation, Fields, and Source views.
6. Implement non-destructive normalized export and inspect both supplied workbook formats.
7. Run complete verification, commit the coherent release, push GitHub, confirm Cloudflare auto-deployment, and smoke-test production.

This sequence preserves the working application while replacing risky assumptions behind stable, independently testable boundaries.
