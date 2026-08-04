import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import open from "open";
import { yaaifFetch } from "../client/tls.js";
import type { Config } from "../config.js";
import type { Session, SessionStore, TokenSet } from "./store.js";

export class ReauthRequiredError extends Error {
  readonly code = "reauth_required";
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export class IssuerMismatchError extends Error {
  readonly code = "issuer_mismatch";
  constructor(
    message: string,
    readonly sessionAuthority: string,
    readonly configAuthority: string,
  ) {
    super(message);
    this.name = "IssuerMismatchError";
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function parseIdToken(idToken: string): { subject?: string; email?: string; name?: string } {
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      subject: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name:
        typeof payload.name === "string"
          ? payload.name
          : typeof payload.preferred_username === "string"
            ? payload.preferred_username
            : undefined,
    };
  } catch {
    return {};
  }
}

function tokenSetFromJson(raw: Record<string, unknown>, previousRefresh?: string): TokenSet {
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : 3600;
  return {
    access_token: String(raw.access_token ?? ""),
    refresh_token: String(raw.refresh_token ?? previousRefresh ?? ""),
    token_type: String(raw.token_type ?? "Bearer"),
    expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
    id_token: typeof raw.id_token === "string" ? raw.id_token : undefined,
  };
}

function normalizeAuthority(v: string): string {
  return v.replace(/\/+$/, "").toLowerCase();
}

export class AuthClient {
  constructor(
    private readonly cfg: Config,
    private readonly store: SessionStore,
  ) {}

  assertIssuerMatch(sess: Session | null): void {
    if (!sess?.tokens.access_token || !sess.oidc_authority) return;
    const sessionAuth = normalizeAuthority(sess.oidc_authority);
    const configAuth = normalizeAuthority(this.cfg.oidcAuthority);
    if (sessionAuth && configAuth && sessionAuth !== configAuth) {
      throw new IssuerMismatchError(
        `session was issued for ${sess.oidc_authority} but config points at ${this.cfg.oidcAuthority}; switch profile or login again`,
        sess.oidc_authority,
        this.cfg.oidcAuthority,
      );
    }
  }

  async login(): Promise<{ session: Session; auth_url: string }> {
    await this.store.ensureHome(this.cfg.cursorHome);
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(24));

    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authUrl = new URL(`${this.cfg.oidcAuthority}/protocol/openid-connect/auth`);
    authUrl.searchParams.set("client_id", this.cfg.oidcClientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", this.cfg.oidcScopes.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    const authUrlStr = authUrl.toString();

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        server.close();
        reject(new Error(`login timed out waiting for browser callback. Open this URL manually: ${authUrlStr}`));
      }, 5 * 60 * 1000);

      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        if (url.searchParams.get("state") !== state) {
          res.writeHead(400).end("invalid state");
          clearTimeout(timer);
          reject(new Error("invalid oauth state"));
          return;
        }
        const err = url.searchParams.get("error");
        if (err) {
          res.writeHead(400).end(err);
          clearTimeout(timer);
          reject(new Error(`oauth error: ${err}`));
          return;
        }
        const authCode = url.searchParams.get("code");
        if (!authCode) {
          res.writeHead(400).end("missing code");
          clearTimeout(timer);
          reject(new Error("missing authorization code"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body style="font-family:system-ui;padding:2rem">
<h2>YAAIF login complete</h2>
<p>Signed in to <code>${this.cfg.oidcAuthority}</code>.</p>
<p>You can close this window and return to Cursor.</p>
</body></html>`);
        clearTimeout(timer);
        resolve(authCode);
        server.close();
      });

      void open(authUrlStr).catch((e) => {
        // Keep listening — user can open the URL manually.
        console.error(`Failed to open browser (${String(e)}). Open this URL: ${authUrlStr}`);
      });
    });

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.cfg.oidcClientId,
      code_verifier: verifier,
    });
    const tokenRes = await yaaifFetch(`${this.cfg.oidcAuthority}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const raw = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      throw new Error(`token exchange failed (${tokenRes.status}): ${JSON.stringify(raw)}`);
    }

    const session = await this.persistTokens(raw);
    return { session, auth_url: authUrlStr };
  }

  /**
   * OAuth 2.0 device authorization grant (headless / CI).
   * Requires Keycloak client attribute oauth2.device.authorization.grant.enabled=true.
   */
  async deviceLogin(opts: { timeout_ms?: number } = {}): Promise<{
    session: Session;
    verification_uri: string;
    user_code: string;
  }> {
    await this.store.ensureHome(this.cfg.cursorHome);
    const deviceEndpoint = `${this.cfg.oidcAuthority}/protocol/openid-connect/auth/device`;
    const startBody = new URLSearchParams({
      client_id: this.cfg.oidcClientId,
      scope: this.cfg.oidcScopes.join(" "),
    });
    const startRes = await yaaifFetch(deviceEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: startBody,
    });
    const startRaw = (await startRes.json()) as Record<string, unknown>;
    if (!startRes.ok) {
      throw new Error(
        `device auth start failed (${startRes.status}): ${JSON.stringify(startRaw)}. ` +
          "Enable oauth2.device.authorization.grant.enabled on the yaaif-cursor Keycloak client.",
      );
    }
    const deviceCode = String(startRaw.device_code ?? "");
    const userCode = String(startRaw.user_code ?? "");
    const verificationUri = String(
      startRaw.verification_uri_complete ?? startRaw.verification_uri ?? "",
    );
    const intervalSec = typeof startRaw.interval === "number" ? startRaw.interval : 5;
    const timeoutMs = opts.timeout_ms ?? 5 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;

    if (verificationUri) {
      void open(verificationUri).catch(() => {
        console.error(`Complete device login at: ${verificationUri} code=${userCode}`);
      });
    }

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.max(intervalSec, 2) * 1000));
      const pollBody = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: this.cfg.oidcClientId,
      });
      const tokenRes = await yaaifFetch(`${this.cfg.oidcAuthority}/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: pollBody,
      });
      const raw = (await tokenRes.json()) as Record<string, unknown>;
      if (tokenRes.ok && raw.access_token) {
        const session = await this.persistTokens(raw);
        return { session, verification_uri: verificationUri, user_code: userCode };
      }
      const err = String(raw.error ?? "");
      if (err === "authorization_pending" || err === "slow_down") continue;
      throw new Error(`device auth poll failed: ${JSON.stringify(raw)}`);
    }
    throw new Error(
      `device login timed out. Open ${verificationUri} and enter code ${userCode}`,
    );
  }

  private async persistTokens(raw: Record<string, unknown>): Promise<Session> {
    const tokens = tokenSetFromJson(raw);
    const claims = tokens.id_token ? parseIdToken(tokens.id_token) : {};
    const session: Session = {
      tokens,
      subject: claims.subject,
      email: claims.email,
      name: claims.name,
      tenant_id: this.cfg.defaultTenantId || undefined,
      profile_id: this.cfg.activeProfileId || undefined,
      oidc_authority: this.cfg.oidcAuthority,
    };
    await this.store.save(session);
    return session;
  }

  async logout(opts: { endSession?: boolean } = {}): Promise<{ logged_out: boolean; end_session_url?: string }> {
    const sess = await this.store.load();
    let end_session_url: string | undefined;
    if (opts.endSession && sess?.tokens.id_token && sess.oidc_authority) {
      const u = new URL(`${sess.oidc_authority}/protocol/openid-connect/logout`);
      u.searchParams.set("id_token_hint", sess.tokens.id_token);
      end_session_url = u.toString();
      void open(end_session_url).catch(() => { /* optional */ });
    }
    await this.store.clear();
    return { logged_out: true, end_session_url };
  }

  async session(): Promise<Session | null> {
    return this.store.load();
  }

  async setTenant(tenantId: string, tenantName?: string): Promise<Session> {
    const sess = await this.store.load();
    if (!sess?.tokens.access_token) throw new ReauthRequiredError("not authenticated; call yaaif_login first");
    this.assertIssuerMatch(sess);
    sess.tenant_id = tenantId.trim();
    if (tenantName) sess.tenant_name = tenantName.trim();
    await this.store.save(sess);
    return sess;
  }

  async accessToken(): Promise<{ token: string; session: Session }> {
    let sess = await this.store.load();
    if (!sess?.tokens.access_token) throw new ReauthRequiredError("not authenticated; call yaaif_login first");
    this.assertIssuerMatch(sess);
    const expiry = Date.parse(sess.tokens.expiry);
    if (Number.isFinite(expiry) && expiry - Date.now() > 45_000) {
      return { token: sess.tokens.access_token, session: sess };
    }
    if (!sess.tokens.refresh_token) {
      await this.store.clear();
      throw new ReauthRequiredError("access token expired and no refresh token; call yaaif_login again");
    }
    try {
      sess = await this.refresh(sess);
    } catch (e) {
      await this.store.clear();
      throw new ReauthRequiredError(`token refresh failed; call yaaif_login again (${String(e)})`);
    }
    return { token: sess.tokens.access_token, session: sess };
  }

  private async refresh(sess: Session): Promise<Session> {
    const authority = sess.oidc_authority || this.cfg.oidcAuthority;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: sess.tokens.refresh_token ?? "",
      client_id: this.cfg.oidcClientId,
    });
    const tokenRes = await yaaifFetch(`${authority}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const raw = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      throw new Error(`refresh token failed (${tokenRes.status}): ${JSON.stringify(raw)}`);
    }
    sess.tokens = tokenSetFromJson(raw, sess.tokens.refresh_token);
    if (sess.tokens.id_token) {
      const claims = parseIdToken(sess.tokens.id_token);
      sess.subject = claims.subject ?? sess.subject;
      sess.email = claims.email ?? sess.email;
      sess.name = claims.name ?? sess.name;
    }
    sess.oidc_authority = authority;
    sess.profile_id = this.cfg.activeProfileId || sess.profile_id;
    await this.store.save(sess);
    return sess;
  }
}
