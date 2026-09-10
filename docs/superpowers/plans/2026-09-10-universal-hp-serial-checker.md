# Universal HP Serial Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing CTC app understand arbitrary one-or-many-serial Excel layouts, resolve HP products safely, expose auditable evidence, and export normalized results without changing source sheets.

**Architecture:** Keep browser-side workbook parsing/export and the Cloudflare HP proxy, but extract pure detector, normalization, resolution, validation, queue, and export functions. Deterministic rules remain primary; a privacy-safe Groq route is used only for ambiguous layout suggestions.

**Tech Stack:** Next.js/vinext, React 19, TypeScript, XlsxPopulate, Cloudflare Workers, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-universal-hp-serial-checker-design.md`

## Global Constraints

- Preserve existing Appendix 3A behavior, CTC styling, and Malaysia PartSurfer context.
- Never use AI to infer hardware or choose an HP product.
- Keep `GROQ_API_KEY` server-side and send only masked workbook structure.
- Preserve original worksheets; add `Spec Results` and `Review Required`.
- The supplied New/Old workbook must normalize to 430 device records.
- Use `VERIFIED`, `REVIEW REQUIRED`, and `UNRESOLVED` as user-facing statuses.

---

### Task 1: Test Harness and Workbook Detector

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `app/lib/workbook/types.ts`
- Create: `app/lib/workbook/detector.ts`
- Test: `app/lib/workbook/detector.test.ts`

**Interfaces:**
- Produces: `detectWorkbookLayout(profile: WorkbookProfile): LayoutAnalysis` and shared workbook mapping types.

- [ ] **Step 1: Add Vitest configuration and write failing detector tests** for Appendix 3A, New/Old columns, three serial columns, title rows, multiple sheets, aliases, duplicates, malformed cells, and merged role headings. Expected examples include two mappings named `New` and `Old` and 430 normalized rows for the collection fixture profile.
- [ ] **Step 2: Run `npm test -- app/lib/workbook/detector.test.ts`** and confirm failure because detector exports do not exist.
- [ ] **Step 3: Implement scoring and mapping discovery** with deterministic header/value/model/product/role signals and confidence/warning output.
- [ ] **Step 4: Re-run the focused test and `npm test`**, requiring zero failures.
- [ ] **Step 5: Commit** with `feat: detect flexible workbook layouts`.

### Task 2: Normalization, Sanitization, and Layout Fallback

**Files:**
- Create: `app/lib/workbook/normalizer.ts`
- Create: `app/lib/workbook/sanitize.ts`
- Create: `app/lib/workbook/normalizer.test.ts`
- Create: `app/lib/workbook/sanitize.test.ts`
- Create: `app/api/layout-resolve/route.ts`

**Interfaces:**
- Consumes: `LayoutAnalysis`, `ColumnMapping`, `WorkbookProfile`.
- Produces: `normalizeDevices(rows, analysis): DeviceRecord[]`, `sanitizeWorkbookProfile(profile): SanitizedProfile`, and POST `/api/layout-resolve` returning a validated mapping suggestion.

- [ ] **Step 1: Write failing tests** proving multiple devices per source row normalize independently, duplicate occurrences remain traceable, serial samples are masked, unrelated personal fields are absent, and invalid AI column references are rejected.
- [ ] **Step 2: Run the focused tests** and confirm expected missing-export failures.
- [ ] **Step 3: Implement normalization and sanitization**, then implement a Groq route using `openai/gpt-oss-20b` by default, strict response validation, missing-key handling, and no workbook-content logging.
- [ ] **Step 4: Run focused and full tests**, requiring zero failures.
- [ ] **Step 5: Commit** with `feat: normalize devices and resolve ambiguous layouts`.

### Task 3: HP Resolution, Specification Evidence, and Validation

**Files:**
- Create: `app/lib/hp/types.ts`
- Create: `app/lib/hp/product-resolver.ts`
- Create: `app/lib/hp/spec-parser.ts`
- Create: `app/lib/hp/validation.ts`
- Create: `app/lib/hp/hp-processing.test.ts`
- Modify: `app/api/hp-lookup/route.ts`
- Modify: `app/lib/device-fields.ts`

**Interfaces:**
- Produces: `resolveProduct(candidates, hints): ProductResolution`, `parseSpecifications(payload): Specification[]`, and `validateDevice(resolution, specs): DeviceValidation`.
- Route accepts `{ serial, modelHint?, productNumberHint? }` and returns identity, candidates, evidence-rich specifications, validation, source URL, and timestamp.

- [ ] **Step 1: Write failing table-driven tests** for zero/one/multiple candidates, SKU priority, serial identity, exact model, unresolved ties, CPU, installed RAM, spare-only RAM, conflicting RAM, storage/GPU/display/battery/network/power/keyboard, and field-level evidence.
- [ ] **Step 2: Run the focused test** and confirm failures name missing behavior.
- [ ] **Step 3: Implement pure resolver/parser/validator functions** and adapt the route to use them while retaining Malaysia requests and safe upstream errors.
- [ ] **Step 4: Run focused/full tests, lint, and type checking**; fix only demonstrated issues.
- [ ] **Step 5: Commit** with `feat: add evidence-based HP product resolution`.

### Task 4: Resilient Lookup Queue

**Files:**
- Create: `app/lib/lookup/queue.ts`
- Create: `app/lib/lookup/queue.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `LookupQueue` with `start`, `pause`, `resume`, `retry`, progress events, bounded concurrency, dedupe, timeout, and exponential retry.

- [ ] **Step 1: Write failing tests** for concurrency bounds, normalized-serial dedupe, transient retries, permanent failure isolation, pause/resume, and individual retry.
- [ ] **Step 2: Run focused tests** and confirm missing queue behavior.
- [ ] **Step 3: Implement the queue** with injected lookup and clock functions, then integrate it into page state without changing presentation yet.
- [ ] **Step 4: Run focused/full tests** and verify existing batch behavior remains available.
- [ ] **Step 5: Commit** with `feat: add resilient serial lookup queue`.

### Task 5: Import Mapping and Business UI

**Files:**
- Create: `app/components/import-mapping.tsx`
- Create: `app/components/results-table.tsx`
- Create: `app/components/evidence-panel.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes normalized device, progress, specification, and validation types.
- Produces grouped source-row and normalized-device views, editable ambiguous mapping, filters, evidence expansion, pause/resume, and retry controls.

- [ ] **Step 1: Write failing component-facing behavior tests** for status/filter/group helper functions extracted as pure logic; verify `REVIEW REQUIRED` reasons remain visible and blank detail regions are not generated.
- [ ] **Step 2: Run tests** and confirm helper behavior is absent.
- [ ] **Step 3: Implement the UI** while preserving CTC branding and routes: CPU & RAM primary, More Info, Validation, Fields, Source, and Guide. Increase readable font sizes and keep tables responsive without hidden horizontal-scroll dependence.
- [ ] **Step 4: Run tests, lint, type check, and local production build**.
- [ ] **Step 5: Commit** with `feat: add universal workbook mapping and evidence UI`.

### Task 6: Non-Destructive Export

**Files:**
- Create: `app/lib/export/results.ts`
- Create: `app/lib/export/results.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `buildSpecResultRows(devices)` and `buildReviewRows(devices)`; page export copies the source workbook then adds `Spec Results` and `Review Required`.

- [ ] **Step 1: Write failing export tests** for one row/device, New/Old roles, 430-row collection output, complete source provenance/evidence columns, and review-only filtering.
- [ ] **Step 2: Run focused tests** and confirm expected missing-export failures.
- [ ] **Step 3: Implement row builders and workbook export**, removing old behavior that writes CPU/RAM into source sheets.
- [ ] **Step 4: Run full tests and inspect generated exports** for both supplied workbook formats, confirming original sheet cells remain unchanged.
- [ ] **Step 5: Commit** with `feat: export normalized device results`.

### Task 7: Release Verification and Deployment

**Files:**
- Modify: `README.md`
- Modify only if required: Cloudflare/GitHub build configuration already in the repository.

**Interfaces:**
- Produces documented local usage, configuration, privacy/validation meaning, GitHub-to-Cloudflare deployment, and a verified production release.

- [ ] **Step 1: Update README** with workflow, supported fields, validation meaning, limits, `GROQ_API_KEY`, optional `GROQ_LAYOUT_MODEL`, local commands, export contract, and deployment flow.
- [ ] **Step 2: Run fresh release gates:** `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build:cloud`.
- [ ] **Step 3: Review `git diff`, generated assets, and secrets**, confirm no workbook/customer data or keys are tracked, and smoke-test local UI/API.
- [ ] **Step 4: Commit release documentation**, push `main` to GitHub, then inspect the GitHub/Cloudflare integration for a successful production build.
- [ ] **Step 5: Smoke-test the live Worker URL** and report commit, deployment, tests, configuration, limitations, and any manual follow-up.
