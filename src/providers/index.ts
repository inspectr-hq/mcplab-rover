import type { ProviderId } from '../contracts';
import type { ChatProviderAdapter } from './types';
import { claudeAdapter } from './claude';
import { trendminerAdapter } from './trendminer';

export const adapters: ChatProviderAdapter[] = [claudeAdapter, trendminerAdapter];

export function findAdapter(provider?: ProviderId): ChatProviderAdapter | null {
  return adapters.find((adapter) => (!provider || adapter.id === provider) && adapter.canHandle()) ?? null;
}
