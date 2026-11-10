import assert from "node:assert/strict";
import test from "node:test";
import { completionScript } from "./completion.js";

test("completion scripts cover current commands without embedding credentials", () => {
  for (const shell of ["bash", "zsh", "fish"] as const) {
    const script = completionScript(shell);
    for (const command of ["setup", "features", "wiki", "updates", "tools", "plugins", "completion"]) {
      assert.ok(script.includes(command), `${shell} missing ${command}`);
    }
    assert.ok(script.includes(shell === "fish" ? "-l table" : "--table"));
    assert.doesNotMatch(script, /access_token|refresh_token|client_secret/);
  }
});
