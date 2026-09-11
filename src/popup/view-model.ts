import type { CheckCounts, LiveTestCatalogItem } from '../mcplab/types';
import type { DebugSnapshot } from '../contracts';
import type { RoverQueueItem } from '../queue/state';

export type PopupMode = 'manual' | 'queue' | 'learn' | 'debug';

export function modeVisibility(mode: PopupMode, hasManualSession: boolean): { catalog: boolean; session: boolean; queue: boolean; debug: boolean } {
  if (mode === 'debug') return { catalog: false, session: false, queue: false, debug: true };
  if (mode === 'learn') return { catalog: false, session: false, queue: false, debug: false };
  return mode === 'manual'
    ? { catalog: !hasManualSession, session: hasManualSession, queue: false, debug: false }
    : { catalog: false, session: false, queue: true, debug: false };
}

export function filterTestCases(items: LiveTestCatalogItem[], query: string): LiveTestCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    `${item.name} ${item.id} ${item.tags?.join(' ') ?? ''}`.toLowerCase().includes(needle)
  );
}

export function formatCheckCounts(counts: CheckCounts): string {
  return `${counts.passed} passed · ${counts.failed} failed · ${counts.not_evaluated} not evaluated`;
}

export function debugFingerprint(snapshot: DebugSnapshot): string {
  return JSON.stringify({
    endpoint: { origin: snapshot.endpoint.origin, connected: snapshot.endpoint.connected, error: snapshot.endpoint.error },
    page: snapshot.page,
    elements: snapshot.elements,
    rover: snapshot.rover
  });
}

const completedQueueStatuses = new Set<RoverQueueItem['status']>(['passed', 'failed', 'incomplete', 'skipped', 'stopped', 'error']);

export function splitQueueItems(items: RoverQueueItem[], evaluationRunId?: string): {
  active: RoverQueueItem[];
  completed: RoverQueueItem[];
  managed: boolean;
} {
  return {
    active: items.filter((item) => !completedQueueStatuses.has(item.status)),
    completed: items.filter((item) => completedQueueStatuses.has(item.status)),
    managed: Boolean(evaluationRunId)
  };
}
