# CTC Serial Number Spec

CTC Serial Number Spec imports an Excel device register, detects its serial-number and specification columns, looks up HP serial-specific hardware data, and exports an enriched workbook containing CPU, RAM, review reasons, and additional device information.

## Local development

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

The local-only `Base files` folder sits beside this project folder. Local development can preload a workbook from there. The folder and its workbooks are intentionally not committed or deployed because they can contain serial numbers and business data.

## Cloudflare deployment

The production build always removes the local source workbook before generating deployment assets:

```powershell
npm run build:cloud
npm run deploy:ci
```

For a one-command manual deployment, run `npm run deploy:cloud`.

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

This repository also includes `.github/workflows/deploy-cloudflare.yml` as a deployment path that is visible in GitHub Actions. To use that path, add these repository secrets under **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token allowed to deploy Workers (use the narrow Workers deployment permissions) |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID that owns `ctc-serial-spec` |

Once those two secrets exist, every push to `main` runs the privacy-safe build and deploys the Worker. Use either this GitHub Actions workflow or Cloudflare Workers Builds for production, rather than enabling both at the same time, to avoid duplicate deployments.

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
