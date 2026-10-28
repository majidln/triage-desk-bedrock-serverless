// Small helpers shared by several parts.

// 0 instead of NaN when there is nothing to divide by.
export function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

// Sort items into piles by key, keeping their order. Works for any grouping:
// category, attack type, and later model.
export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(item);
  }
  return groups;
}

// Display formats.
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
