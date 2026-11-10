import { readFile } from "node:fs/promises";

export type ParsedArgs = {
  positionals: string[];
  values: Map<string, string>;
  flags: Set<string>;
};

export function parseArgs(
  argv: string[],
  options: { strings?: string[]; booleans?: string[] } = {},
): ParsedArgs {
  const strings = new Set(options.strings ?? []);
  const booleans = new Set(options.booleans ?? []);
  const parsed: ParsedArgs = { positionals: [], values: new Map(), flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      parsed.positionals.push(arg);
      continue;
    }
    const equal = arg.indexOf("=");
    const name = equal >= 0 ? arg.slice(0, equal) : arg;
    if (booleans.has(name)) {
      if (equal >= 0) throw new Error(`${name} does not take a value`);
      parsed.flags.add(name);
      continue;
    }
    if (!strings.has(name)) throw new Error(`unknown option: ${name}`);
    const value = equal >= 0 ? arg.slice(equal + 1) : argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
    parsed.values.set(name, value);
  }
  return parsed;
}

export function required(value: string | undefined, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error(message);
  return trimmed;
}

export function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

export async function readToolArguments(raw: string | undefined): Promise<Record<string, unknown>> {
  if (raw === undefined) return {};
  let text = raw;
  if (raw === "-") {
    text = await new Promise<string>((resolve, reject) => {
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => resolve(input));
      process.stdin.on("error", reject);
    });
  } else if (raw.startsWith("@")) {
    text = await readFile(raw.slice(1), "utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`tool arguments must be valid JSON: ${String(error)}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
