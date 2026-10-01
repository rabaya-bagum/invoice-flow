/**
 * Builds a parameterised `UPDATE ... SET` from a camelCase patch and a whitelist mapping
 * (camelCase key -> column). Keys not in the whitelist are ignored, so request bodies can never
 * touch columns like business_id or total_minor. Returns null if there is nothing to update.
 */
export function buildSet(
  patch: Record<string, unknown>,
  columns: Record<string, string>,
  firstParam = 1,
): { sql: string; values: unknown[] } | null {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    parts.push(`${col} = $${firstParam + values.length - 1}`);
  }
  return parts.length ? { sql: parts.join(', '), values } : null;
}

/** Escape LIKE wildcards so user search text is matched literally. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
