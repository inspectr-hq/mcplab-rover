import type { ProviderId } from '../contracts';

export const BUILT_IN_PROVIDER_IDS = ['claude', 'chatgpt-com'] as const;

export function isBuiltInProvider(provider: ProviderId): boolean {
  return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(provider);
}
