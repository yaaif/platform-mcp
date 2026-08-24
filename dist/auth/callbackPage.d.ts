export type CallbackReturnTo = "Cursor" | "Codex" | "Claude Code" | "YAA\\F Desktop";
export declare function renderLoginCallbackPage(opts: {
    ok: boolean;
    heading: string;
    message: string;
    detail?: string;
    returnTo: CallbackReturnTo;
}): string;
