export type TelemetryState = {
    enabled: boolean;
    counters: Record<string, number>;
    updated_at?: string;
};
export declare class TelemetryStore {
    private readonly cursorHome;
    readonly path: string;
    constructor(cursorHome: string);
    load(): Promise<TelemetryState>;
    save(state: TelemetryState): Promise<void>;
    setEnabled(enabled: boolean): Promise<TelemetryState>;
    increment(name: string, by?: number): Promise<void>;
}
/** Redact secrets from objects before logging or returning diagnostics. */
export declare function redactSecrets(value: unknown): unknown;
