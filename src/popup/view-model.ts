import type { CheckCounts, LiveTestCatalogItem } from '../mcplab/types';

export type PopupMode = 'manual' | 'queue';

export function modeVisibility(mode: PopupMode, hasManualSession: boolean): { catalog: boolean; session: boolean; queue: boolean } {
  return mode === 'manual'
    ? { catalog: !hasManualSession, session: hasManualSession, queue: false }
    : { catalog: false, session: false, queue: true };
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
