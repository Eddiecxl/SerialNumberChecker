import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const configPath = resolve(process.cwd(), 'dist', 'server', 'wrangler.json');
const customDomain = String(process.env.CLOUDFLARE_CUSTOM_DOMAIN ?? '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const config = JSON.parse(await readFile(configPath, 'utf8'));
config.compatibility_date = '2026-09-10';

if (customDomain) {
  if (
    customDomain.includes('/') ||
    customDomain.includes('*') ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(customDomain)
  ) {
    throw new Error(
      'CLOUDFLARE_CUSTOM_DOMAIN must be a bare hostname such as devices.example.com.',
    );
  }

  config.routes = [{ pattern: customDomain, custom_domain: true }];
  console.log(`Prepared Cloudflare custom domain: ${customDomain}`);
} else {
  delete config.routes;
  console.log('No custom domain configured; workers.dev remains active.');
}

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
