import type { RoverState } from '../contracts';
import { DEFAULT_MCPLAB_ORIGIN, normalizeMcplabOrigin } from '../mcplab/api-client';
import type { RoverQueueState } from '../queue/state';

export const STATE_KEY = 'rover.run';
export const ORIGIN_KEY = 'rover.mcplabOrigin';
export const QUEUE_KEY = 'rover.queue';

export async function getState(): Promise<RoverState | null> {
  return ((await chrome.storage.session.get(STATE_KEY))[STATE_KEY] as RoverState | undefined) ?? null;
}

export async function saveState(state: RoverState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

export async function getQueue(): Promise<RoverQueueState | null> {
  return ((await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] as RoverQueueState | undefined) ?? null;
}

export async function saveQueue(queue: RoverQueueState): Promise<void> {
  await chrome.storage.session.set({ [QUEUE_KEY]: queue });
}

export async function resolveOrigin(requested?: string): Promise<string> {
  const stored = (await chrome.storage.sync.get(ORIGIN_KEY))[ORIGIN_KEY];
  const origin = normalizeMcplabOrigin(requested ?? (typeof stored === 'string' ? stored : DEFAULT_MCPLAB_ORIGIN));
  if (stored !== origin) await chrome.storage.sync.set({ [ORIGIN_KEY]: origin });
  return origin;
}
