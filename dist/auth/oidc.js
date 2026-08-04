import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import open from "open";
function b64url(buf) {
    return buf.toString("base64url");
}
function parseIdToken(idToken) {
    const parts = idToken.split(".");
    if (parts.length < 2)
        return {};
    try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        return {
            subject: typeof payload.sub === "string" ? payload.sub : undefined,
            email: typeof payload.email === "string" ? payload.email : undefined,
            name: typeof payload.name === "string"
                ? payload.name
                : typeof payload.preferred_username === "string"
                    ? payload.preferred_username
                    : undefined,
        };
    }
    catch {
        return {};
    }
}
function tokenSetFromJson(raw, previousRefresh) {
    const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : 3600;
    return {
        access_token: String(raw.access_token ?? ""),
        refresh_token: String(raw.refresh_token ?? previousRefresh ?? ""),
        token_type: String(raw.token_type ?? "Bearer"),
        expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
        id_token: typeof raw.id_token === "string" ? raw.id_token : undefined,
    };
}
export class AuthClient {
    cfg;
    store;
    constructor(cfg, store) {
        this.cfg = cfg;
        this.store = store;
    }
    async login() {
        await this.store.ensureHome(this.cfg.cursorHome);
        const verifier = b64url(randomBytes(32));
        const challenge = b64url(createHash("sha256").update(verifier).digest());
        const state = b64url(randomBytes(24));
        const server = createServer();
        await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const code = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                server.close();
                reject(new Error("login timed out waiting for browser callback"));
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
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<html><body><h2>YAAIF login complete</h2><p>You can close this window.</p></body></html>");
                clearTimeout(timer);
                resolve(authCode);
                server.close();
            });
            const authUrl = new URL(`${this.cfg.oidcAuthority}/protocol/openid-connect/auth`);
            authUrl.searchParams.set("client_id", this.cfg.oidcClientId);
            authUrl.searchParams.set("response_type", "code");
            authUrl.searchParams.set("redirect_uri", redirectUri);
            authUrl.searchParams.set("scope", this.cfg.oidcScopes.join(" "));
            authUrl.searchParams.set("state", state);
            authUrl.searchParams.set("code_challenge", challenge);
            authUrl.searchParams.set("code_challenge_method", "S256");
            void open(authUrl.toString()).catch((e) => {
                clearTimeout(timer);
                server.close();
                reject(e);
            });
        });
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: this.cfg.oidcClientId,
            code_verifier: verifier,
        });
        const tokenRes = await fetch(`${this.cfg.oidcAuthority}/protocol/openid-connect/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        const raw = (await tokenRes.json());
        if (!tokenRes.ok) {
            throw new Error(`token exchange failed (${tokenRes.status}): ${JSON.stringify(raw)}`);
        }
        const tokens = tokenSetFromJson(raw);
        const claims = tokens.id_token ? parseIdToken(tokens.id_token) : {};
        const session = {
            tokens,
            subject: claims.subject,
            email: claims.email,
            name: claims.name,
            tenant_id: this.cfg.defaultTenantId || undefined,
        };
        await this.store.save(session);
        return session;
    }
    async logout() {
        await this.store.clear();
    }
    async session() {
        return this.store.load();
    }
    async setTenant(tenantId) {
        const sess = await this.store.load();
        if (!sess?.tokens.access_token)
            throw new Error("not authenticated; call yaaif_login first");
        sess.tenant_id = tenantId.trim();
        await this.store.save(sess);
        return sess;
    }
    async accessToken() {
        let sess = await this.store.load();
        if (!sess?.tokens.access_token)
            throw new Error("not authenticated; call yaaif_login first");
        const expiry = Date.parse(sess.tokens.expiry);
        if (Number.isFinite(expiry) && expiry - Date.now() > 45_000) {
            return { token: sess.tokens.access_token, session: sess };
        }
        if (!sess.tokens.refresh_token)
            throw new Error("access token expired; call yaaif_login again");
        sess = await this.refresh(sess);
        return { token: sess.tokens.access_token, session: sess };
    }
    async refresh(sess) {
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: sess.tokens.refresh_token ?? "",
            client_id: this.cfg.oidcClientId,
        });
        const tokenRes = await fetch(`${this.cfg.oidcAuthority}/protocol/openid-connect/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        const raw = (await tokenRes.json());
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
        await this.store.save(sess);
        return sess;
    }
}
