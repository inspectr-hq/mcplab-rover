import type { ProviderId } from '../contracts';
import type { ChatProviderAdapter } from './types';
import { claudeAdapter } from './claude';
import { chatgptAdapter } from './chatgpt';
import { trendminerAdapter } from './trendminer';
import { createLearnedAdapter } from './learned';
import type { BrowserProviderProfile } from '../mcplab/types';

const builtInAdapters: ChatProviderAdapter[] = [claudeAdapter, chatgptAdapter, trendminerAdapter];
let learnedAdapters: ChatProviderAdapter[] = [];

export const adapters: ChatProviderAdapter[] = [...builtInAdapters];

export function setLearnedProfiles(profiles: BrowserProviderProfile[]): void {
  learnedAdapters = profiles.map(createLearnedAdapter);
  adapters.splice(0, adapters.length, ...learnedAdapters, ...builtInAdapters);
}

export function findAdapter(provider?: ProviderId): ChatProviderAdapter | null {
  return adapters.find((adapter) => (!provider || adapter.id === provider) && adapter.matchesPage() && adapter.canHandle()) ?? null;
}

export function findPageAdapter(): ChatProviderAdapter | null {
  return adapters.find((adapter) => adapter.matchesPage() && adapter.canHandle()) ?? null;
}
