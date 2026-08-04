import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const path = new URL("../dist/cli.js", import.meta.url);
let text = readFileSync(path, "utf8");
const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "#!/usr/bin/env node");
text = "#!/usr/bin/env node\n" + lines.join("\n");
if (!text.endsWith("\n")) text += "\n";
writeFileSync(path, text);
chmodSync(path, 0o755);
