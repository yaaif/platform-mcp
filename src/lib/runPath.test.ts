import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAdminUiCanvasUrl,
  extractAmbientRunId,
  isRunActivelyWaiting,
  resolveRunNodeExecutionLabel,
  shapeRunPath,
} from "./runPath.js";

const stepGraph = {
  nodes: [
    { id: "lookup", type: "tool_call" },
    { id: "review", type: "approval" },
    { id: "apply", type: "action" },
    { id: "done", type: "do_nothing" },
  ],
};

test("leftover waiting block becomes EXECUTED after the run continues", () => {
  assert.equal(
    resolveRunNodeExecutionLabel({
      latestStatus: "waiting",
      executed: true,
      blockStatuses: ["waiting"],
      runIsActivelyWaiting: false,
    }),
    "EXECUTED",
  );
});

test("keeps WAITING while the run is still parked", () => {
  assert.equal(isRunActivelyWaiting("awaiting_approval"), true);
  assert.equal(
    resolveRunNodeExecutionLabel({
      latestStatus: "waiting",
      executed: false,
      blockStatuses: ["waiting"],
      runIsActivelyWaiting: true,
    }),
    "WAITING",
  );
});

test("shapeRunPath reports coverage/path and prefers failed current step", () => {
  const path = shapeRunPath({
    run: {
      id: "run-1",
      status: "failed",
      workflow_graph: stepGraph,
      state_blocks: [
        { node_id: "lookup", status: "completed", sequence: 1 },
        { node_id: "review", status: "failed", sequence: 2 },
      ],
    },
    apiBaseUrl: "https://platform.yaaif.ai",
    runId: "run-1",
  });
  assert.ok(path);
  assert.equal(path.coverage.label, "2/4 reached");
  assert.equal(path.path.label, "1/2 finished on this path");
  assert.equal(path.counts.executed, 1);
  assert.equal(path.counts.failed, 1);
  assert.equal(path.counts.pending, 2);
  assert.equal(path.tone, "failed");
  assert.deepEqual(path.current_step, { node_id: "review", label: "FAILED" });
  assert.equal(
    path.admin_ui_canvas_url,
    "https://platform.yaaif.ai/admin/workflow-runs?ar_run=run-1&ar_run_tab=workflow-canvas&ar_canvas_info=review",
  );
});

test("run status wins over leftover wait when computing tone", () => {
  const path = shapeRunPath({
    run: {
      id: "run-2",
      status: "completed",
      workflow_graph: stepGraph,
      state_blocks: [
        { node_id: "lookup", status: "completed", sequence: 1 },
        { node_id: "review", status: "waiting", sequence: 2 },
        { node_id: "apply", status: "completed", sequence: 3 },
        { node_id: "done", status: "completed", sequence: 4 },
      ],
    },
  });
  assert.ok(path);
  assert.equal(path.tone, "completed");
  assert.equal(path.counts.waiting, 0);
  assert.equal(path.counts.executed, 4);
  assert.equal(path.coverage.label, "4/4 reached");
  assert.equal(path.current_step, null);
});

test("current_step prefers waiting after fail/running when the run is paused", () => {
  const path = shapeRunPath({
    run: {
      id: "run-3",
      status: "awaiting_approval",
      workflow_graph: stepGraph,
      state_blocks: [
        { node_id: "lookup", status: "completed", sequence: 1 },
        { node_id: "review", status: "waiting", sequence: 2 },
      ],
    },
  });
  assert.ok(path);
  assert.equal(path.tone, "waiting");
  assert.deepEqual(path.current_step, { node_id: "review", label: "WAITING" });
});

test("engine-only graphs still get path metrics from those nodes", () => {
  const path = shapeRunPath({
    run: {
      status: "running",
      workflow_graph: {
        nodes: [
          { id: "watcher", type: "watcher" },
          { id: "orchestrator", type: "orchestrator" },
        ],
      },
      state_blocks: [{ node_id: "watcher", status: "completed", sequence: 1 }],
    },
  });
  assert.ok(path);
  assert.equal(path.coverage.total, 2);
  assert.equal(path.coverage.reached, 1);
});

test("buildAdminUiCanvasUrl omits canvas info without a current step", () => {
  assert.equal(
    buildAdminUiCanvasUrl("https://platform.yaaif.local/agent-service", "abc"),
    "https://platform.yaaif.local/admin/workflow-runs?ar_run=abc&ar_run_tab=workflow-canvas",
  );
});

test("extractAmbientRunId prefers explicit id then links", () => {
  assert.equal(extractAmbientRunId({ links: { ambient_run_id: "from-links" } }, "arg"), "arg");
  assert.equal(extractAmbientRunId({ links: { ambient_run_id: "from-links" } }), "from-links");
});
