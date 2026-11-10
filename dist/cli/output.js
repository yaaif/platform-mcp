function cell(value) {
    if (value === undefined || value === null)
        return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
function renderRows(rows) {
    if (!rows.length)
        return "";
    const limited = rows.slice(0, 20);
    const columns = [...new Set(limited.flatMap((row) => Object.keys(row)))].slice(0, 7);
    const widths = columns.map((column) => Math.min(60, Math.max(column.length, ...limited.map((row) => cell(row[column]).length))));
    const line = (values) => values.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
    const output = [line(columns.map((column) => column.toUpperCase())), line(widths.map((width) => "-".repeat(width)))];
    for (const row of limited)
        output.push(line(columns.map((column) => cell(row[column]))));
    if (rows.length > limited.length)
        output.push(`… ${rows.length - limited.length} more row(s)`);
    return output.join("\n");
}
function arrayRows(data) {
    if (Array.isArray(data))
        return data.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    if (!data || typeof data !== "object")
        return undefined;
    const record = data;
    if (record.features && typeof record.features === "object" && !Array.isArray(record.features)) {
        return Object.entries(record.features).map(([feature, value]) => ({ feature, ...value }));
    }
    for (const container of [record.result, record]) {
        if (Array.isArray(container))
            return arrayRows(container);
        if (!container || typeof container !== "object")
            continue;
        for (const key of ["items", "tenants", "checks", "pages", "jobs", "agents", "skills", "runs", "tools"]) {
            const value = container[key];
            if (Array.isArray(value))
                return arrayRows(value);
        }
    }
    return undefined;
}
export function renderToolTable(result) {
    const summary = toolText(result).split("\n\n")[0];
    const data = result.structuredContent;
    const rows = arrayRows(data);
    if (rows?.length)
        return `${summary}\n\n${renderRows(rows)}`;
    if (data && typeof data === "object" && !Array.isArray(data)) {
        const scalars = Object.fromEntries(Object.entries(data).filter(([, value]) => value === null || typeof value !== "object"));
        if (Object.keys(scalars).length)
            return `${summary}\n\n${renderRows([scalars])}`;
    }
    return summary || JSON.stringify(data ?? result.content, null, 2);
}
export function printData(data, json) {
    if (!json && typeof data === "string") {
        process.stdout.write(`${data}\n`);
        return;
    }
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
export function printToolResult(result, json, table = false) {
    if (json) {
        printData(result.structuredContent ?? { content: result.content }, true);
    }
    else if (table) {
        process.stdout.write(`${renderToolTable(result)}\n`);
    }
    else {
        const text = toolText(result);
        process.stdout.write(`${text || JSON.stringify(result.structuredContent ?? result.content, null, 2)}\n`);
    }
    return result.isError ? 1 : 0;
}
export function toolText(result) {
    return result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
}
