/** Merge skill id lists: existing order preserved, then new ids appended (deduped). */
export function mergeSkillIds(existing: string[] | undefined, add: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(existing ?? []), ...(add ?? [])]) {
    const trimmed = String(id ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
