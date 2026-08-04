import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTenants, parseTenantMemberships, resolveTenant } from "./tenants.js";

test("resolveTenant matches id name and slug", () => {
  const members = parseTenantMemberships({
    items: [
      { tenant_id: "aaa-111", tenant_name: "Acme Corp", role: "admin", active: true },
      { tenant_id: "bbb-222", tenant_name: "Beta", role: "user", active: true },
    ],
  });
  const byId = resolveTenant(members, "aaa-111");
  assert.ok("tenant" in byId);
  assert.equal(byId.tenant.tenant_id, "aaa-111");

  const byName = resolveTenant(members, "Acme Corp");
  assert.ok("tenant" in byName);
  assert.equal(byName.tenant.tenant_name, "Acme Corp");

  const bySlug = resolveTenant(members, "acme-corp");
  assert.ok("tenant" in bySlug);
  assert.equal(bySlug.tenant.tenant_id, "aaa-111");
});

test("normalizeTenants marks last and selected", () => {
  const members = parseTenantMemberships([
    { tenant_id: "a", tenant_name: "A" },
    { tenant_id: "b", tenant_name: "B" },
  ]);
  const norm = normalizeTenants(members, { lastTenantId: "b", selectedTenantId: "a" });
  assert.equal(norm.find((t) => t.id === "a")?.is_selected, true);
  assert.equal(norm.find((t) => t.id === "b")?.is_last, true);
});
