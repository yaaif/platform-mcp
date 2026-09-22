import assert from "node:assert/strict";
import test from "node:test";
import {
  collectWorkerIds,
  latestInstalledVersion,
  summarizeWorkerPackage,
  TOOL_INSTALL_DISPATCH_TYPE,
  TOOL_REMOVE_DISPATCH_TYPE,
} from "./toolPackageWorker.js";

test("collectWorkerIds de-dupes worker_id and worker_ids", () => {
  assert.deepEqual(collectWorkerIds("w1", ["w1", " w2 ", ""]), ["w1", "w2"]);
});

test("summarizeWorkerPackage recommends upgrade when versions differ", () => {
  const runs = [
    {
      id: "r1",
      worker_id: "w1",
      status: "completed",
      created_at: "2026-01-01T00:00:00Z",
      payload: {
        dispatch_type: TOOL_INSTALL_DISPATCH_TYPE,
        package_id: "pkg-1",
        tool_key: "sap-gui.mcp",
        version: "1.0.0",
      },
    },
  ];
  const status = summarizeWorkerPackage("w1", runs, "pkg-1", "sap-gui.mcp", "1.1.0");
  assert.equal(status.installed, true);
  assert.equal(status.installed_version, "1.0.0");
  assert.equal(status.update_available, true);
  assert.equal(status.recommended_action, "upgrade");
  assert.equal(latestInstalledVersion(runs, "w1", "pkg-1", "sap-gui.mcp"), "1.0.0");
});

test("summarizeWorkerPackage treats completed remove as not installed", () => {
  const runs = [
    {
      id: "r1",
      worker_id: "w1",
      status: "completed",
      created_at: "2026-01-01T00:00:00Z",
      payload: { dispatch_type: TOOL_INSTALL_DISPATCH_TYPE, package_id: "pkg-1", tool_key: "sap-gui.mcp", version: "1.0.0" },
    },
    {
      id: "r2",
      worker_id: "w1",
      status: "completed",
      created_at: "2026-01-02T00:00:00Z",
      payload: { dispatch_type: TOOL_REMOVE_DISPATCH_TYPE, package_id: "pkg-1", tool_key: "sap-gui.mcp" },
    },
  ];
  const status = summarizeWorkerPackage("w1", runs, "pkg-1", "sap-gui.mcp", "1.0.0");
  assert.equal(status.installed, false);
  assert.equal(status.recommended_action, "install");
});
