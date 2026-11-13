import assert from "node:assert/strict";
import test from "node:test";
import { boundedErrorText, ApiHttpError } from "./http.js";

test("short error bodies pass through trimmed", () => {
  assert.equal(boundedErrorText("  not found\n"), "not found");
});

test("long error bodies are cut and say how much", () => {
  const out = boundedErrorText(`<html>${"x".repeat(5000)}</html>`);
  assert.ok(out.length < 560);
  assert.match(out, /^<html>x+/);
  assert.match(out, /\[truncated \d+ chars\]$/);
});


test("structured diagnostics cannot create unbounded tool error output", () => {
  const error = new ApiHttpError("bounded",422,{error_code:"x".repeat(200),details:Array.from({length:100},()=>"d".repeat(3000)),files:Array.from({length:100},()=>"p".repeat(900))});
  assert.equal(error.code!.length,128);
  assert.equal(error.details.length,50);
  assert.equal(error.details[0].length,1000);
  assert.equal(error.files.length,50);
  assert.equal(error.files[0].length,512);
});
