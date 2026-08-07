import assert from "node:assert/strict";
import test from "node:test";
import {
  deploymentLogsPath,
  deploymentToUpdateBody,
  normalizeTransportType,
  resolveDeploymentMethod,
} from "../lib/mcpDeployments.js";

test("normalizeTransportType maps HTTP and empty to STREAMABLE_HTTP", () => {
  assert.equal(normalizeTransportType(undefined), "STREAMABLE_HTTP");
  assert.equal(normalizeTransportType(""), "STREAMABLE_HTTP");
  assert.equal(normalizeTransportType("HTTP"), "STREAMABLE_HTTP");
  assert.equal(normalizeTransportType("streamable_http"), "STREAMABLE_HTTP");
  assert.equal(normalizeTransportType("SSE"), "SSE");
  assert.equal(normalizeTransportType("sse"), "SSE");
});

test("resolveDeploymentMethod prefers explicit then settings then compose", () => {
  assert.equal(resolveDeploymentMethod("kubernetes_gitops", null), "kubernetes_gitops");
  assert.equal(
    resolveDeploymentMethod(undefined, { default_deployment_method: "kubernetes_gitops" }),
    "kubernetes_gitops",
  );
  assert.equal(resolveDeploymentMethod(undefined, null), "docker_compose");
  assert.equal(
    resolveDeploymentMethod("docker_compose", { default_deployment_method: "kubernetes_gitops" }),
    "docker_compose",
  );
});

test("deploymentLogsPath routes by method", () => {
  assert.equal(
    deploymentLogsPath("abc", "docker_compose", 50),
    "/api/mcp-deployments/abc/logs?tail=50",
  );
  assert.equal(
    deploymentLogsPath("abc", "kubernetes_gitops", 100),
    "/api/mcp-deployments/abc/k8s/logs?tail=100",
  );
});

test("deploymentToUpdateBody clears endpoint_host when null override", () => {
  const body = deploymentToUpdateBody(
    {
      name: "demo",
      image: "img:1",
      endpoint_host: "old.example",
      transport_type: "HTTP",
    },
    { endpoint_host: null, image: "img:2" },
  );
  assert.equal(body.image, "img:2");
  assert.equal(body.transport_type, "STREAMABLE_HTTP");
  assert.equal("endpoint_host" in body, false);
});
