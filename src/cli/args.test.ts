import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optionalNumber, parseArgs, readToolArguments } from "./args.js";

test("parseArgs handles values, equals forms, booleans and positionals", () => {
  const parsed = parseArgs(["item", "--limit=5", "--online", "--q", "graph"], {
    strings: ["--limit", "--q"],
    booleans: ["--online"],
  });
  assert.deepEqual(parsed.positionals, ["item"]);
  assert.equal(parsed.values.get("--limit"), "5");
  assert.equal(parsed.values.get("--q"), "graph");
  assert.ok(parsed.flags.has("--online"));
  assert.equal(optionalNumber(parsed.values.get("--limit"), "--limit"), 5);
});

test("parseArgs rejects unknown or missing options", () => {
  assert.throws(() => parseArgs(["--wat"]), /unknown option/);
  assert.throws(() => parseArgs(["--q"], { strings: ["--q"] }), /requires a value/);
  assert.throws(() => optionalNumber("zero", "--limit"), /positive number/);
});

test("readToolArguments reads JSON objects from a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yaaif-cli-args-"));
  try {
    const path = join(dir, "args.json");
    await writeFile(path, JSON.stringify({ workflow_id: "w1", enabled: false }));
    assert.deepEqual(await readToolArguments(`@${path}`), { workflow_id: "w1", enabled: false });
    await assert.rejects(() => readToolArguments("[]"), /JSON object/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
