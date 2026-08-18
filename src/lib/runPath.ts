/** Port of admin-ui run-canvas-metrics + canvas jump priority for ops summaries. */

import { ENGINE_NODE_TYPES, STEP_NODE_TYPES, asRecord, asString, graphNodes } from "./workflowGraph.js";

export type RunNodeExecutionLabel = "EXECUTED" | "RUNNING" | "WAITING" | "FAILED" | "PENDING";

export type RunStepStatusCounts = {
  executed: number;
  running: number;
  waiting: number;
  failed: number;
  pending: number;
};

export type RunStepMetricTone = "waiting" | "failed" | "running" | "completed" | "idle";

export type RunPathCurrentStep = {
  node_id: string;
  label: "FAILED" | "RUNNING" | "WAITING";
};

export type RunPathSummary = {
  counts: RunStepStatusCounts;
  coverage: { reached: number; total: number; label: string };
  path: { executed: number; reached: number; label: string };
  current_step: RunPathCurrentStep | null;
  tone: RunStepMetricTone;
  title: string;
  admin_ui_canvas_url?: string;
};

export function emptyRunStepStatusCounts(): RunStepStatusCounts {
  return { executed: 0, running: 0, waiting: 0, failed: 0, pending: 0 };
}

export function totalRunStepCount(counts: RunStepStatusCounts): number {
  return counts.executed + counts.running + counts.waiting + counts.failed + counts.pending;
}

export function reachedRunStepCount(counts: RunStepStatusCounts): number {
  return counts.executed + counts.running + counts.waiting + counts.failed;
}

export function normalizeRunStatus(runStatus: string): string {
  return runStatus.trim().toLowerCase();
}

export function isRunActivelyWaiting(runStatus: string, isTimedWait = false): boolean {
  const status = normalizeRunStatus(runStatus);
  if (status === "waiting" || status === "paused" || status === "awaiting_approval") {
    return true;
  }
  return status === "queued" && isTimedWait;
}

export function resolveRunNodeExecutionLabel(input: {
  latestStatus?: string;
  executed: boolean;
  blockStatuses?: string[];
  runIsActivelyWaiting: boolean;
}): RunNodeExecutionLabel {
  const latestStatus = (input.latestStatus ?? "").trim().toLowerCase();
  const blockStatuses = (input.blockStatuses ?? []).map((status) => status.trim().toLowerCase());

  if (latestStatus === "failed") {
    return "FAILED";
  }
  if (latestStatus === "running" || latestStatus === "started") {
    return "RUNNING";
  }

  const hasCompletedBlock = blockStatuses.some((status) => status === "completed" || status === "succeeded");
  if (hasCompletedBlock) {
    return "EXECUTED";
  }

  const isWaitingLatest = latestStatus === "waiting" || latestStatus === "queued" || latestStatus === "paused";
  if (isWaitingLatest) {
    if (input.runIsActivelyWaiting) {
      return "WAITING";
    }
    if (input.executed) {
      return "EXECUTED";
    }
    return "PENDING";
  }

  if (input.executed || latestStatus === "completed" || latestStatus === "succeeded") {
    return "EXECUTED";
  }
  return "PENDING";
}

export function describeRunStepMetrics(
  runStatus: string,
  counts: RunStepStatusCounts,
  options?: { isTimedWait?: boolean },
): { title: string; detail: string; tone: RunStepMetricTone } {
  const status = normalizeRunStatus(runStatus);
  const total = totalRunStepCount(counts);
  const activelyWaiting = isRunActivelyWaiting(status, options?.isTimedWait === true);

  if (status === "failed") {
    return {
      title: "Failed",
      detail: `${counts.failed} failed · ${counts.executed} executed`,
      tone: "failed",
    };
  }

  if (status === "completed" || status === "succeeded") {
    return {
      title: "Completed",
      detail: total === 1 ? "1 step executed" : `${counts.executed} steps executed`,
      tone: "completed",
    };
  }

  if (counts.failed > 0) {
    return {
      title: "Failed",
      detail: `${counts.failed} failed · ${counts.executed} executed`,
      tone: "failed",
    };
  }

  if (status === "awaiting_approval") {
    return {
      title: "Awaiting approval",
      detail: counts.waiting <= 1 ? "1 step is paused" : `${counts.waiting} steps need a decision`,
      tone: "waiting",
    };
  }

  if (activelyWaiting) {
    return {
      title: "Waiting",
      detail: counts.waiting === 1 ? "1 step is paused" : `${Math.max(counts.waiting, 1)} steps are paused`,
      tone: "waiting",
    };
  }

  if (counts.running > 0 || status === "running") {
    return {
      title: "In progress",
      detail: `${counts.executed} executed · ${counts.running} running`,
      tone: "running",
    };
  }

  if (status === "queued") {
    return {
      title: "Queued",
      detail: total === 1 ? "1 step not started" : `${counts.pending || total} steps not started`,
      tone: "idle",
    };
  }

  return {
    title: "Step states",
    detail: `${counts.executed} executed · ${counts.pending} not started`,
    tone: "idle",
  };
}

export function buildAdminUiCanvasUrl(
  apiBaseUrl: string,
  runId: string,
  currentStepId?: string,
): string | undefined {
  const origin = adminUiOrigin(apiBaseUrl);
  const id = runId.trim();
  if (!origin || !id) {
    return undefined;
  }
  const url = new URL("/admin/workflow-runs", origin);
  url.searchParams.set("ar_run", id);
  url.searchParams.set("ar_run_tab", "workflow-canvas");
  const nodeId = (currentStepId ?? "").trim();
  if (nodeId) {
    url.searchParams.set("ar_canvas_info", nodeId);
  }
  return url.toString();
}

export function shapeRunPath(input: {
  run?: unknown;
  apiBaseUrl?: string;
  runId?: string;
}): RunPathSummary | undefined {
  const run = resolveRunRecord(input.run);
  if (!run) {
    return undefined;
  }

  const graph = run.workflow_graph ?? run.workflowGraph;
  const nodes = pickCoverageNodes(graphNodes(graph));
  if (nodes.length === 0 && !asString(run.status)) {
    return undefined;
  }

  const blocks = collectStateBlocks(run);
  const blocksByNode = groupBlocksByNode(blocks);
  const runStatus = asString(run.status);
  const runIsActivelyWaiting = isRunActivelyWaiting(runStatus, Boolean(run.is_timed_wait ?? run.isTimedWait));

  const counts = emptyRunStepStatusCounts();
  const labeled: Array<{
    node_id: string;
    label: RunNodeExecutionLabel;
    sequence: number;
    createdAt: number;
  }> = [];

  for (const node of nodes) {
    const related = blocksByNode.get(node.id) ?? blocksByNode.get(node.id.toLowerCase()) ?? [];
    const latest = related[related.length - 1];
    const blockStatuses = related.map((block) => block.status);
    const executed =
      related.length > 0 ||
      blockStatuses.some((status) => status === "completed" || status === "succeeded");
    const label = resolveRunNodeExecutionLabel({
      latestStatus: latest?.status,
      executed,
      blockStatuses,
      runIsActivelyWaiting,
    });
    incrementCount(counts, label);
    labeled.push({
      node_id: node.id,
      label,
      sequence: latest?.sequence ?? 0,
      createdAt: latest?.createdAt ?? 0,
    });
  }

  const reached = reachedRunStepCount(counts);
  const total = totalRunStepCount(counts);
  const metrics = describeRunStepMetrics(runStatus, counts, {
    isTimedWait: Boolean(run.is_timed_wait ?? run.isTimedWait),
  });
  const current = pickCurrentStep(labeled);
  const runId = (input.runId ?? asString(run.id)).trim();
  const canvasUrl = input.apiBaseUrl
    ? buildAdminUiCanvasUrl(input.apiBaseUrl, runId, current?.node_id)
    : undefined;

  const summary: RunPathSummary = {
    counts,
    coverage: {
      reached,
      total,
      label: total === 0 ? "0/0 reached" : `${reached}/${total} reached`,
    },
    path: {
      executed: counts.executed,
      reached,
      label: reached === 0 ? "0/0 finished on this path" : `${counts.executed}/${reached} finished on this path`,
    },
    current_step: current,
    tone: metrics.tone,
    title: metrics.title,
  };
  if (canvasUrl) {
    summary.admin_ui_canvas_url = canvasUrl;
  }
  return summary;
}

export function extractAmbientRunId(result: unknown, fallback?: string): string {
  const fromArg = (fallback ?? "").trim();
  if (fromArg) {
    return fromArg;
  }
  const record = asRecord(result);
  const top = asString(record.ambient_run_id);
  if (top) {
    return top;
  }
  const links = asRecord(record.links);
  const fromLinks = asString(links.ambient_run_id);
  if (fromLinks) {
    return fromLinks;
  }
  const seed = asRecord(record.seed);
  return asString(seed.ambient_run_id);
}

function resolveRunRecord(run: unknown): Record<string, unknown> | undefined {
  const record = asRecord(run);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const nested = asRecord(record.run);
  if (nested.workflow_graph || nested.workflowGraph || Array.isArray(nested.state_blocks)) {
    return { ...nested, status: nested.status ?? record.status, id: nested.id ?? record.id };
  }
  if (record.workflow_graph || record.workflowGraph || Array.isArray(record.state_blocks)) {
    return record;
  }
  if (asString(record.status) || asString(nested.status)) {
    return Object.keys(nested).length > 0
      ? { ...nested, status: nested.status ?? record.status, id: nested.id ?? record.id }
      : record;
  }
  return undefined;
}

function pickCoverageNodes(nodes: Array<{ id: string; type: string }>): Array<{ id: string; type: string }> {
  const steps = nodes.filter((node) => STEP_NODE_TYPES.has(node.type));
  if (steps.length > 0) {
    return steps;
  }
  const nonEngine = nodes.filter((node) => node.id && !ENGINE_NODE_TYPES.has(node.type));
  if (nonEngine.length > 0) {
    return nonEngine;
  }
  return nodes.filter((node) => node.id);
}

type BlockInfo = { nodeId: string; status: string; sequence: number; createdAt: number };

function collectStateBlocks(run: Record<string, unknown>): BlockInfo[] {
  const raw = run.state_blocks ?? run.stateBlocks ?? run.workflow_state_blocks;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: BlockInfo[] = [];
  for (const item of raw) {
    const block = asRecord(item);
    const nodeId = asString(block.node_id ?? block.nodeID);
    if (!nodeId) {
      continue;
    }
    out.push({
      nodeId,
      status: asString(block.status),
      sequence: asNumber(block.sequence ?? block.step_seq),
      createdAt: parseDateMs(block.created_at ?? block.createdAt),
    });
  }
  out.sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
  return out;
}

function groupBlocksByNode(blocks: BlockInfo[]): Map<string, BlockInfo[]> {
  const map = new Map<string, BlockInfo[]>();
  for (const block of blocks) {
    const key = block.nodeId;
    const current = map.get(key) ?? [];
    current.push(block);
    map.set(key, current);
    const lower = key.toLowerCase();
    if (lower !== key && !map.has(lower)) {
      map.set(lower, current);
    }
  }
  return map;
}

function incrementCount(counts: RunStepStatusCounts, label: RunNodeExecutionLabel): void {
  switch (label) {
    case "EXECUTED":
      counts.executed += 1;
      break;
    case "RUNNING":
      counts.running += 1;
      break;
    case "WAITING":
      counts.waiting += 1;
      break;
    case "FAILED":
      counts.failed += 1;
      break;
    default:
      counts.pending += 1;
  }
}

function pickCurrentStep(
  labeled: Array<{ node_id: string; label: RunNodeExecutionLabel; sequence: number; createdAt: number }>,
): RunPathCurrentStep | null {
  const pick = (want: RunNodeExecutionLabel): typeof labeled[0] | undefined => {
    const candidates = labeled.filter((item) => item.label === want);
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.reduce((best, item) => {
      if (item.sequence > best.sequence) {
        return item;
      }
      if (item.sequence < best.sequence) {
        return best;
      }
      return item.createdAt > best.createdAt ? item : best;
    });
  };

  const failed = pick("FAILED");
  if (failed) {
    return { node_id: failed.node_id, label: "FAILED" };
  }
  const running = pick("RUNNING");
  if (running) {
    return { node_id: running.node_id, label: "RUNNING" };
  }
  const waiting = pick("WAITING");
  if (waiting) {
    return { node_id: waiting.node_id, label: "WAITING" };
  }
  return null;
}

function adminUiOrigin(apiBaseUrl: string): string | undefined {
  const raw = apiBaseUrl.trim();
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDateMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const raw = asString(value);
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
