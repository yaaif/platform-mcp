import type { AuthClient } from "../auth/oidc.js";
import type { ApiClient } from "../client/http.js";
import type { Config } from "../config.js";
import type { PlanExecutionStore } from "../lib/planExecution.js";
import type { TelemetryStore } from "../lib/telemetry.js";
import type { ProfileStore } from "../platform/profiles.js";
export type Ctx = {
    cfg: Config;
    auth: AuthClient;
    api: ApiClient;
    profiles: ProfileStore;
    plans: PlanExecutionStore;
    telemetry: TelemetryStore;
};
