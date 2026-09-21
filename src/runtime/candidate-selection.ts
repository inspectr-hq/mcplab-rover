export interface ResponseCandidate {
  key: string;
  text: string;
  visible: boolean;
  /** True when a replacement node has no provider-supplied turn identifier. */
  ephemeralIdentity?: boolean;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function selectResponseCandidate(
  baseline: ResponseCandidate[],
  current: ResponseCandidate[]
): ResponseCandidate | null {
  const previousByKey = new Map(
    baseline.map((candidate) => [candidate.key, normalize(candidate.text)])
  );
  const previousTexts = new Set(baseline.map((candidate) => normalize(candidate.text)));
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const candidate = current[index];
    if (!candidate.visible) continue;
    const text = normalize(candidate.text);
    if (!text) continue;
    if (candidate.ephemeralIdentity && baseline.length > 0 && current.length <= baseline.length)
      continue;
    if (previousByKey.has(candidate.key)) continue;
    if (candidate.ephemeralIdentity && !previousByKey.has(candidate.key) && previousTexts.has(text))
      continue;
    return { ...candidate, text };
  }
  return null;
}
