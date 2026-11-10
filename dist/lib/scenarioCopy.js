function pick(record, keys) {
    return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}
export async function copyScenario(options) {
    const { source, destination, specId, newSlug, dryRun, confirm } = options;
    let revision = options.revision;
    if (!revision) {
        const current = await source.api.agentJSON("GET", `/api/agent-specs/${encodeURIComponent(specId)}`);
        revision = current.current_revision ?? current.version ?? 1;
    }
    const document = await source.api.agentJSON("GET", `/api/agent-specs/${encodeURIComponent(specId)}/revisions/${revision}/export`);
    const snapshot = document.snapshot;
    if (!snapshot?.slug)
        throw new Error("source Scenario export has no snapshot slug");
    const slug = newSlug?.trim() || snapshot.slug;
    const listed = await destination.api.agentJSON("GET", `/api/agent-specs?q=${encodeURIComponent(slug)}&limit=200`);
    const conflict = (listed.items ?? []).some((item) => item.slug === slug);
    const preview = {
        spec_id: specId,
        revision,
        manifest_hash: document.manifest_hash ?? null,
        source_profile_id: source.cfg.activeProfileId,
        destination_profile_id: destination.cfg.activeProfileId,
        slug,
        name: snapshot.name ?? slug,
        conflict,
        would_create: !conflict,
        counts: {
            segments: snapshot.segments?.length ?? 0,
            requirements: snapshot.requirements?.length ?? 0,
            slots: snapshot.slots?.length ?? 0,
        },
        excluded: ["bindings", "release_history", "provenance", "tenant_ids", "credentials", "tokens"],
    };
    if (dryRun)
        return { dry_run: true, ...preview };
    if (!confirm)
        throw new Error("review the copy preview first, then rerun with --yes");
    if (conflict)
        throw new Error(`destination Scenario slug already exists: ${slug}; choose --new-slug`);
    const body = {
        slug,
        name: snapshot.name ?? slug,
        description: snapshot.description ?? "",
        status: "draft",
        source: "server_copy",
        segments: (snapshot.segments ?? []).map((item) => pick(item, ["segment_key", "title", "body_md", "payload", "status", "sort_order"])),
        requirements: (snapshot.requirements ?? []).map((item) => pick(item, ["req_key", "title", "statement", "priority", "category", "acceptance_criteria", "status", "sort_order"])),
        slots: (snapshot.slots ?? []).map((item) => pick(item, ["slot_key", "kind", "expected_name", "notes", "requirement_keys", "status", "sort_order"])),
    };
    const created = await destination.api.agentJSON("POST", "/api/agent-specs", body);
    const createdId = created.id ?? slug;
    const verified = await destination.api.agentJSON("GET", `/api/agent-specs/${encodeURIComponent(createdId)}`);
    return { dry_run: false, ...preview, created: { id: createdId, slug, verified } };
}
