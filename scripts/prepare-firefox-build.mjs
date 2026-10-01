import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIREFOX_ADDON_ID = 'mcplab-rover@inspectr.dev';

export function firefoxManifestFromChrome(chromeManifest) {
  const { background: _background, ...manifest } = chromeManifest;
  return {
    ...manifest,
    background: {
      scripts: ['background.js'],
      type: chromeManifest.background?.type ?? 'module'
    },
    browser_specific_settings: {
      ...(chromeManifest.browser_specific_settings ?? {}),
      gecko: {
        ...(chromeManifest.browser_specific_settings?.gecko ?? {}),
        id: FIREFOX_ADDON_ID
      }
    }
  };
}

async function main() {
  const sourceDir = resolve('dist');
  const firefoxDir = resolve('dist-firefox');
  await rm(firefoxDir, { recursive: true, force: true });
  await cp(sourceDir, firefoxDir, { recursive: true });

  const manifestPath = resolve(firefoxDir, 'manifest.json');
  const chromeManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const firefoxManifest = firefoxManifestFromChrome(chromeManifest);
  await writeFile(manifestPath, `${JSON.stringify(firefoxManifest, null, 2)}\n`);
  console.log(`Prepared Firefox extension in ${firefoxDir}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
