import type { ProviderId } from '../contracts';
import type { ChatProviderAdapter } from './types';
import { claudeAdapter } from './claude';
import { chatgptAdapter } from './chatgpt';
import { createMcplabAdapter } from './mcplab';
import { isValidBrowserProviderProfile } from './profile-validation';
import { isBuiltInProviderProfile } from './catalog';
export { BUILT_IN_PROVIDER_IDS, isBuiltInProvider, isBuiltInProviderProfile } from './catalog';

const builtInAdapters: ChatProviderAdapter[] = [claudeAdapter, chatgptAdapter];
let learnedAdapters: ChatProviderAdapter[] = [];

export const adapters: ChatProviderAdapter[] = [...builtInAdapters];

export function setLearnedProfiles(profiles: unknown[]): void {
  learnedAdapters = profiles
    .filter(isValidBrowserProviderProfile)
    .filter((profile) => !isBuiltInProviderProfile(profile))
    .map(createMcplabAdapter);
  adapters.splice(0, adapters.length, ...learnedAdapters, ...builtInAdapters);
}

export function findAdapter(provider?: ProviderId): ChatProviderAdapter | null {
  return (
    adapters.find(
      (adapter) =>
        (!provider || adapter.id === provider) && adapter.matchesPage() && adapter.canHandle()
    ) ?? null
  );
}

export function findPageAdapter(): ChatProviderAdapter | null {
  return adapters.find((adapter) => adapter.matchesPage() && adapter.canHandle()) ?? null;
}

export function findPageAdapters(): ChatProviderAdapter[] {
  return adapters.filter((adapter) => adapter.matchesPage() && adapter.canHandle());
}
