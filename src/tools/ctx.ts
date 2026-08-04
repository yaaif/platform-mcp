import type { AuthClient } from "../auth/oidc.js";
import type { ApiClient } from "../client/http.js";
import type { Config } from "../config.js";

export type Ctx = { cfg: Config; auth: AuthClient; api: ApiClient };
