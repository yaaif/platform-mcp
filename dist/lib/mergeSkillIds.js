/** Merge skill id lists: existing order preserved, then new ids appended (deduped). */
export function mergeSkillIds(existing, add) {
    const out = [];
    const seen = new Set();
    for (const id of [...(existing ?? []), ...(add ?? [])]) {
        const trimmed = String(id ?? "").trim();
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}
