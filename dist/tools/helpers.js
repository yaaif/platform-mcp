export function ok(summary, data) {
    return {
        content: [{ type: "text", text: summary }],
        structuredContent: (data ?? { ok: true }),
    };
}
export function fail(message) {
    return {
        content: [{ type: "text", text: message }],
        isError: true,
        structuredContent: { error: message },
    };
}
