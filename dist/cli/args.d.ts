export type ParsedArgs = {
    positionals: string[];
    values: Map<string, string>;
    flags: Set<string>;
};
export declare function parseArgs(argv: string[], options?: {
    strings?: string[];
    booleans?: string[];
}): ParsedArgs;
export declare function required(value: string | undefined, message: string): string;
export declare function optionalNumber(value: string | undefined, name: string): number | undefined;
export declare function readToolArguments(raw: string | undefined): Promise<Record<string, unknown>>;
