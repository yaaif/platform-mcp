import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_API_KEY_ENV, PLATFORM_API_KEY_HEADER } from "./registerApiKeys.js";

test("platform API key env/header constants match product", () => {
  assert.equal(PLATFORM_API_KEY_ENV, "YAAIF_MCP_PLATFORM_API_KEY");
  assert.equal(PLATFORM_API_KEY_HEADER, "X-YAAIF-Platform-Key");
});
