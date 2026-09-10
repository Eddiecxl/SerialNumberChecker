# CTC Serial Number Spec

CTC Serial Number Spec imports varied Excel device registers, detects every device/serial relationship, looks up HP PartSurfer in the Malaysia region, and exports traceable hardware results. CPU and RAM remain the primary outputs; available storage, graphics, display, battery, network, power, keyboard, system board, OS, optical, audio, and other HP configuration lines are also retained.

## Business workflow

1. Import an `.xlsx` file. The browser inspects every sheet and detects one or many serial-number columns, including related New/Old model and product-number hints.
2. Confirm any lower-confidence workbook mapping. Deterministic rules handle normal files; optional Groq assistance analyzes masked structure only when a layout is ambiguous.
3. Run the lookup. Each unique serial is sent once to HP, with bounded concurrency, timeout, retry/backoff, duplicate reuse, and pause/resume.
4. Review CPU/RAM, other device information, product resolution, raw HP descriptions, HP part numbers, and source links.
5. Export a copy containing all original worksheets unchanged plus `Spec Results` (one row per device) and `Review Required`.

A source row containing both New and Old serials creates two result records. The supplied 215-row collection listing therefore creates 430 device result rows.

## Validation meaning

- **VERIFIED:** HP product identity, CPU, and RAM are supported by serial-specific HP configuration evidence.
- **REVIEW REQUIRED:** a useful result exists but depends on compatible-spare/product-level evidence, has conflicting options, or cannot prove the installed configuration.
- **UNRESOLVED:** HP returned no usable product/specification or the lookup failed after retries.

The app validates parser traceability: it shows the source descriptions, part numbers, match method, lookup time, and HP page. For customer-critical delivery, compare the evidence with the live HP page and verify the present hardware in BIOS, Windows inventory, or physically. A factory BOM may not reflect later upgrades or repairs.

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Quality gates:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build:cloud
```

The local-only `Base files` folder sits beside this project folder. Local development can preload a workbook from there. The folder and its workbooks are intentionally not committed or deployed because they can contain serial numbers and business data.

## Cloudflare deployment

The production build always removes the local source workbook before generating deployment assets:

```powershell
npm run build:cloud
npm run deploy:ci
```

For a one-command manual deployment, run `npm run deploy:cloud`.

### Optional Groq layout fallback

The app works without AI. To enable one-call assistance for ambiguous workbook structures, configure these only in the Cloudflare Worker environment:

| Variable | Type | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Secret | Authorizes the server-side Groq request. Never expose it to browser code. |
| `GROQ_LAYOUT_MODEL` | Text, optional | Defaults to `openai/gpt-oss-20b`. |

Groq receives column headers, counts, and masked value shapes—not employee names, departments, complete serials, or full workbook rows. Invalid or unavailable AI output falls back to human confirmation.

### Automatic deployments from GitHub

Connect the existing `ctc-serial-spec` Worker to this repository in **Cloudflare Dashboard → Workers & Pages → ctc-serial-spec → Settings → Builds → Connect**.

Use these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build:cloud` |
| Deploy command | `npm run deploy:ci` |

After the connection is saved, every push to `main` builds and deploys automatically. Other branches can produce preview versions using Cloudflare's default preview command.

Cloudflare Workers Builds supplies and stores the deployment authorization for the connected Worker, so this repository does not require a GitHub API-token secret. Do not add a separate GitHub Actions deployment unless you specifically want to manage Cloudflare credentials yourself.

### Custom domain

The simplest option is **Cloudflare Dashboard → Workers & Pages → ctc-serial-spec → Settings → Domains & Routes → Add → Custom Domain**. Enter a hostname from a domain already active in the same Cloudflare account. Cloudflare creates the DNS record and TLS certificate.

For a domain managed from the Git build instead, add this non-secret build variable under **Settings → Builds → Variables and secrets**:

```text
CLOUDFLARE_CUSTOM_DOMAIN=devices.example.com
```

Use only a bare hostname—no `https://`, path, or wildcard. The next production deployment will attach it as a Worker Custom Domain. Leave the variable unset to keep only the `workers.dev` address.

## Privacy

- Excel uploads are processed in the browser.
- The cloud build does not include the local Base workbook.
- Serial numbers are sent to the app's Worker API only when an HP lookup is requested.
- Do not commit exported workbooks, source workbooks, environment files, or credentials.

## Current limitations

- Only HP serial numbers recognized by PartSurfer are authoritative in this release.
- Results depend on HP availability, rate limits, response format, and completeness.
- Compatible service parts prove compatibility, not installed hardware; these remain under review.
- Multiple HP products are auto-selected only by exact product number, HP serial identity, exact normalized model, or a single remaining candidate. The app never asks AI to guess hardware or a product.
- Very unusual or poorly labelled workbook layouts may require user confirmation.
