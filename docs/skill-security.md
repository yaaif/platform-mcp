# SkillSpector knowledge for IDE repairs

The bridge bundles a source-aware triage and repair SOP, available without
network access, authentication, or a running scanner:

```json
{"action":"guide"}
```

Call `yaaif_skill_security` with that input. Optional `topic` values are
`overview`, `triage`, `repair`, `troubleshooting`, and `sources`.
Terminal users can run:

```sh
yaaif tools call yaaif_skill_security --args '{"action":"guide","topic":"triage"}'
```

The maintained source is [skillSecurityGuide.ts](../src/lib/skillSecurityGuide.ts).
It distinguishes upstream concepts from YAAIF behavior, explains permission and
metadata findings, covers conditional file repairs and uncertain write recovery,
and requires fresh validation and scan evidence after edits. Guide output never
changes policy or grants activation approval.

Admin UI **Fix with IDE** passes platform, tenant, branch, scan identity and an
optional selected finding. Both per-finding and whole-scan handoffs tell the IDE
to load this guide before interpreting security diagnostics.

Sources are attributed in `action=guide, topic=sources`, with pinned NVIDIA links
matching the scanner reference revision at authoring time. The SOP is an original
YAAIF adaptation, not an exhaustive copy of NVIDIA documentation; actual scanner
version, runtime capabilities and report coverage remain authoritative.
