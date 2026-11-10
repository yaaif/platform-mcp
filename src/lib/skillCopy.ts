import type { Runtime } from "../runtime.js";

export type SkillCopyOptions = {
  source: Runtime;
  destination: Runtime;
  skillId: string;
  newSkillId?: string;
  dryRun: boolean;
  confirm?: boolean;
};

type SkillMetadata = {
  id?: string;
  name?: string;
  description?: string;
  instruction?: string;
  tools?: string[];
  allowed_tools?: string[];
  classification?: string;
  enabled?: boolean;
};

type FileNode = {
  path?: string;
  name?: string;
  kind?: string;
  children?: FileNode[];
};

type FileContent = {
  path: string;
  content: string;
  destinationPath: string;
};

function flatten(node: FileNode | undefined, files: FileNode[] = []): FileNode[] {
  if (!node) return files;
  if (!node.children?.length && (node.kind === "file" || node.kind === "regular" || !node.kind)) files.push(node);
  for (const child of node.children ?? []) flatten(child, files);
  return files;
}

function safeRelative(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "." || !part)) {
    throw new Error(`unsafe skill file path: ${path}`);
  }
  return normalized;
}

function destinationPath(sourceId: string, newId: string, path: string): string {
  const relative = safeRelative(path);
  if (relative === "SKILL.md") return `${newId}/SKILL.md`;
  return relative.startsWith(`${sourceId}/`) ? `${newId}/${relative.slice(sourceId.length + 1)}` : `${newId}/${relative}`;
}

function sensitiveReason(path: string, content: string): string | undefined {
  const name = path.split("/").pop()!.toLowerCase();
  if (name === "credentials.yaml" || name === ".env" || name.startsWith(".env.") || /^(id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx|jks|keystore))$/.test(name)) {
    return "credential or private-key file";
  }
  if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(content)) return "embedded private key";
  return undefined;
}

function frontmatterName(content: string, newId: string): string {
  const name = newId.split("/").pop() ?? newId;
  return content.replace(/^name:\s*.+$/m, `name: ${name}`);
}

export async function copySkill(options: SkillCopyOptions) {
  const { source, destination, skillId, newSkillId, dryRun, confirm } = options;
  const sourceResult = await source.api.agentJSON<{ items?: SkillMetadata[] }>(
    "GET",
    `/api/skills?ids=${encodeURIComponent(skillId)}&limit=1`,
  );
  const metadata = sourceResult.items?.[0];
  if (!metadata) throw new Error(`skill not found: ${skillId}`);
  const tree = await source.api.agentJSON<{ root?: FileNode }>("GET", `/api/skill-files/tree?path=${encodeURIComponent(skillId)}`);
  const files = flatten(tree.root ?? tree as FileNode);
  if (!files.length) throw new Error(`skill has no files: ${skillId}`);
  if (files.length > 500) throw new Error("skill pack exceeds the 500-file copy limit");
  const id = newSkillId?.trim() || skillId;
  const existing = await destination.api.agentJSON<{ items?: SkillMetadata[] }>(
    "GET",
    `/api/skills?ids=${encodeURIComponent(id)}&limit=1`,
  );
  const conflict = Boolean(existing.items?.length);
  const contents: FileContent[] = [];
  const excluded: Array<{ path: string; reason: string }> = [];
  let totalBytes = 0;
  for (const file of files) {
    const path = file.path ?? file.name ?? "";
    const view = await source.api.agentJSON<{ content?: string }>("GET", `/api/skill-files/content?path=${encodeURIComponent(path)}`);
    const content = String(view.content ?? "");
    const reason = sensitiveReason(path, content);
    if (reason) {
      if (path.endsWith("SKILL.md")) throw new Error(`refusing to copy sensitive ${path}: ${reason}`);
      excluded.push({ path, reason });
      continue;
    }
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > 10 * 1024 * 1024) throw new Error("skill pack exceeds the 10 MiB content copy limit");
    const target = destinationPath(skillId, id, path);
    contents.push({ path, content: path.endsWith("SKILL.md") ? frontmatterName(content, id) : content, destinationPath: target });
  }
  const preview = {
    skill_id: skillId,
    new_skill_id: id,
    source_profile_id: source.cfg.activeProfileId,
    destination_profile_id: destination.cfg.activeProfileId,
    conflict,
    files: contents.map((file) => ({ source: file.path, destination: file.destinationPath })),
    excluded,
    total_bytes: totalBytes,
    mappings_copied: false,
    bindings_copied: false,
  };
  if (dryRun) return { dry_run: true, ...preview };
  if (!confirm) throw new Error("review the skill copy preview first, then rerun with --yes");
  if (conflict) throw new Error(`destination skill already exists: ${id}; choose --new-id`);
  await destination.api.agentJSON("POST", "/api/skills", {
    id,
    name: id.split("/").pop() ?? id,
    description: metadata.description ?? "",
    instruction: metadata.instruction ?? "",
    tools: metadata.tools ?? [],
    allowed_tools: metadata.allowed_tools ?? metadata.tools ?? [],
    classification: metadata.classification ?? "general",
    enabled: metadata.enabled ?? true,
    updated_by: destination.cfg.client.updatedBy,
    assigned_user_emails: [],
    scaffold: { include_references: true, include_examples: true },
  });
  for (const file of contents) {
    await destination.api.agentJSON("PUT", "/api/skill-files/content", { path: file.destinationPath, content: file.content });
  }
  const verified = await destination.api.agentJSON("GET", `/api/skills?ids=${encodeURIComponent(id)}&limit=1`);
  return { dry_run: false, ...preview, created: { id, verified } };
}
