import type { CheckCounts, LiveTestCatalogItem } from '../mcplab/types';

export type PopupMode = 'manual' | 'queue' | 'debug';

export function modeVisibility(mode: PopupMode, hasManualSession: boolean): { catalog: boolean; session: boolean; queue: boolean; debug: boolean } {
  if (mode === 'debug') return { catalog: false, session: false, queue: false, debug: true };
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
