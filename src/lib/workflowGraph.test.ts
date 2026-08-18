import assert from "node:assert/strict";
import { test } from "node:test";
import { isEngineSpineOnlyGraph } from "./workflowGraph.js";

test("engine spine with no steps is flagged", () => {
  assert.equal(
    isEngineSpineOnlyGraph({
      nodes: [
        { id: "watcher", type: "watcher" },
        { id: "evaluator", type: "evaluator" },
        { id: "guardian", type: "guardian" },
        { id: "orchestrator", type: "orchestrator" },
        { id: "recorder", type: "recorder" },
      ],
    }),
    true,
  );
});

test("mixed engine + step graph is not flagged", () => {
  assert.equal(
    isEngineSpineOnlyGraph({
      nodes: [
        { id: "orchestrator", type: "orchestrator" },
        { id: "lookup", type: "tool_call" },
      ],
    }),
    false,
  );
});

test("step-only graph is not flagged", () => {
  assert.equal(
    isEngineSpineOnlyGraph({
      nodes: [
        { id: "lookup", type: "tool_call" },
        { id: "done", type: "do_nothing" },
      ],
    }),
    false,
  );
});

test("empty or missing nodes is not flagged", () => {
  assert.equal(isEngineSpineOnlyGraph({}), false);
  assert.equal(isEngineSpineOnlyGraph({ nodes: [] }), false);
  assert.equal(isEngineSpineOnlyGraph(null), false);
});
