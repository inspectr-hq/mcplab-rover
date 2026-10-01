import { describe, expect, it } from 'vitest';
import { firefoxManifestFromChrome } from '../scripts/prepare-firefox-build.mjs';

describe('Firefox build manifest', () => {
  it('uses a background script and preserves the release version', () => {
    const manifest = firefoxManifestFromChrome({
      manifest_version: 3,
      name: 'MCPLab Rover',
      version: '0.3.0',
      background: {
        service_worker: 'background.js',
        type: 'module'
      }
    });

    expect(manifest).toMatchObject({
      manifest_version: 3,
      name: 'MCPLab Rover',
      version: '0.3.0',
      background: {
        scripts: ['background.js'],
        type: 'module'
      },
      browser_specific_settings: {
        gecko: { id: 'mcplab-rover@inspectr.dev' }
      }
    });
    expect(manifest.background).not.toHaveProperty('service_worker');
  });
});
