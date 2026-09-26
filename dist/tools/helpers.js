function textWithData(summary, data) {
    if (data === undefined)
        return summary;
    try {
        return `${summary}\n\n${JSON.stringify(data, null, 2)}`;
    }
    catch {
        return summary;
    }
}
export function ok(summary, data) {
    const structured = (data ?? { ok: true });
    return {
        content: [{ type: "text", text: textWithData(summary, data === undefined ? undefined : structured) }],
        structuredContent: structured,
    };
}
export function fail(message, data) {
    const structured = { error: message, ...(data ?? {}) };
    return {
        content: [{ type: "text", text: textWithData(message, data ? structured : undefined) }],
        isError: true,
        structuredContent: structured,
    };
}
