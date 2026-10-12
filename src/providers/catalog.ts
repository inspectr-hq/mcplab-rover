import type { ProviderId } from '../contracts';
import type { BrowserProviderProfile } from '../mcplab/types';

export const BUILT_IN_PROVIDER_IDS = ['claude', 'chatgpt-com'] as const;

export function isBuiltInProvider(provider: ProviderId): boolean {
  return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(provider);
}

export function isBuiltInProviderProfile(
  profile: Pick<BrowserProviderProfile, 'id' | 'source'>
): boolean {
  return profile.source === 'builtin' && isBuiltInProvider(profile.id);
}
