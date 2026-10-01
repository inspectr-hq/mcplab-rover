export const FIREFOX_ADDON_ID: string;
export function firefoxManifestFromChrome(chromeManifest: {
  background?: { type?: string; [key: string]: unknown };
  browser_specific_settings?: { gecko?: Record<string, unknown> };
  [key: string]: unknown;
}): Record<string, unknown>;
