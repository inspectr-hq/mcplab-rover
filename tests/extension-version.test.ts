import { describe, expect, it } from 'vitest';
import { manifestWithVersion, resolveExtensionVersion } from '../scripts/set-extension-version.mjs';

describe('extension versioning', () => {
  it('uses the numeric version from a release tag', () => {
    expect(resolveExtensionVersion('v0.3.0')).toBe('0.3.0');
  });

  it('rejects release tags that are not vX.Y.Z', () => {
    expect(() => resolveExtensionVersion('v0.3')).toThrow(/vX\.Y\.Z/);
    expect(() => resolveExtensionVersion('release-0.3.0')).toThrow(/vX\.Y\.Z/);
  });

  it('uses the development fallback without a release tag', () => {
    expect(resolveExtensionVersion(undefined)).toBe('0.0.0');
  });

  it('writes the resolved version into the manifest', () => {
    const manifest = manifestWithVersion(
      JSON.stringify({ name: 'MCPLab Rover', version: '0.0.0' }),
      '0.3.0'
    );

    expect(JSON.parse(manifest)).toMatchObject({ name: 'MCPLab Rover', version: '0.3.0' });
  });
});
