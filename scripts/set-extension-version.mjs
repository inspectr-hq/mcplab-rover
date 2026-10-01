import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEVELOPMENT_VERSION = '0.0.0';

export function resolveExtensionVersion(releaseRef, fallback = DEVELOPMENT_VERSION) {
  if (!releaseRef) return fallback;

  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(releaseRef);
  if (!match) {
    throw new Error(`Release tag "${releaseRef}" must use the vX.Y.Z format.`);
  }

  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function manifestWithVersion(manifestText, version) {
  const manifest = JSON.parse(manifestText);
  manifest.version = version;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main() {
  const manifestPath = resolve('dist/manifest.json');
  const version = resolveExtensionVersion(process.env.GITHUB_REF_NAME);
  const manifest = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, manifestWithVersion(manifest, version));
  console.log(`Set extension manifest version to ${version}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
