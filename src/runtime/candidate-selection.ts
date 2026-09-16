export interface ResponseCandidate {
  key: string;
  text: string;
  visible: boolean;
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
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const candidate = current[index];
    if (!candidate.visible) continue;
    const text = normalize(candidate.text);
    if (!text) continue;
    if (previousByKey.get(candidate.key) === text) continue;
    return { ...candidate, text };
  }
  return null;
}
