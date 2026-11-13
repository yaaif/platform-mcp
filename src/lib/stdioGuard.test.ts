import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { guardStdioPipes } from "./stdioGuard.js";

const epipe = () => Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

test("a closed stderr does not end the server; a closed stdout exits quietly", () => {
  const stdout = new EventEmitter() as unknown as NodeJS.WriteStream;
  const stderr = new EventEmitter() as unknown as NodeJS.WriteStream;
  const exits: number[] = [];
  guardStdioPipes(stdout, stderr, (code) => exits.push(code));
  // Without a listener, emitting "error" throws: that was the crash.
  assert.doesNotThrow(() => stderr.emit("error", epipe()));
  assert.deepEqual(exits, []);
  stdout.emit("error", epipe());
  assert.deepEqual(exits, [0]);
});
