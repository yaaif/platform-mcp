export declare const TOOL_PACKAGE_PLATFORMS: readonly ["windows", "macos", "linux"];
export type ToolPackagePlatform = (typeof TOOL_PACKAGE_PLATFORMS)[number];
export type ToolPackageLanguage = "python" | "node" | "go" | "binary" | "unknown";
export type ToolPackageLaunch = {
    tool_key: string;
    version: string;
    display_name: string;
    description: string;
    interpreter: string;
    command_args: string[];
    env_template: Record<string, string>;
    capabilities: string[];
    timeout_seconds: number;
    git_remote_url?: string;
    git_commit_sha?: string;
};
export type ToolPackageArtifactPlan = {
    platform: ToolPackagePlatform;
    archive_format: "zip" | "tar.gz" | "tar";
    entrypoint: string;
    source: "manifest" | "dist-binary" | "source-tree" | "artifact_path";
    wrap_file?: string;
    warnings: string[];
};
export type ToolPackageInspectResult = {
    source_dir: string;
    language: ToolPackageLanguage;
    kind: "command_mcp";
    launch: ToolPackageLaunch;
    artifact: ToolPackageArtifactPlan;
    file_count: number;
    warnings: string[];
    manifest_path: string | null;
};
export type InspectToolPackageInput = {
    source_dir: string;
    platform?: string;
    artifact_path?: string;
    tool_key?: string;
    version?: string;
    display_name?: string;
    description?: string;
    interpreter?: string;
    command_args?: string[];
    env_template?: Record<string, string>;
    capabilities?: string[];
    timeout_seconds?: number;
    entrypoint?: string;
    git_remote_url?: string;
    git_commit_sha?: string;
};
export declare function normalizeToolPackagePlatform(raw: string | undefined): ToolPackagePlatform | "";
export declare function hostPlatform(): ToolPackagePlatform;
export declare function toolKeyFromDirName(dirName: string): string;
export declare function inspectCommandMcpCodebase(input: InspectToolPackageInput): ToolPackageInspectResult;
export type BuiltToolPackageArchive = {
    buffer: Buffer;
    file_name: string;
    content_type: string;
    archive_format: "zip" | "tar.gz" | "tar";
    entrypoint: string;
    platform: ToolPackagePlatform;
    file_count: number;
};
export declare function buildToolPackageArchive(inspected: ToolPackageInspectResult): BuiltToolPackageArchive;
export declare function encodeMultipart(fields: Record<string, string>, file: {
    field: string;
    filename: string;
    body: Buffer;
    contentType?: string;
}): {
    buffer: Buffer;
    contentType: string;
};
export declare function listPackableFiles(dir: string, opts?: {
    includeDist?: boolean;
}): string[];
