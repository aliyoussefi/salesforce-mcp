import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { ServerConfig } from "./config.js";
import { TokenProvider, Tokens } from "./token-store.js";

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

export class OAuthTokenProvider implements TokenProvider {
  constructor(
    private readonly server: string,
    private readonly config: ServerConfig,
    private readonly store: TokenProvider,
  ) {}

  async get(server: string): Promise<Tokens | undefined> {
    if (server !== this.server) return undefined;
    const current = await this.store.get(server);
    if (current?.accessToken && (!current.expiresAt || current.expiresAt > Date.now() + 60_000)) {
      return current;
    }
    if (current?.refreshToken && this.config.auth?.tokenEndpoint && this.config.clientId) {
      const refreshed = await this.refresh(current.refreshToken);
      await this.store.set(server, refreshed);
      return refreshed;
    }
    if (this.config.auth?.tokenEndpoint && this.config.clientId &&
        (this.config.auth.authorizationEndpoint || this.config.auth.deviceCodeEndpoint)) {
      const authorized = this.useDeviceCode() ? await this.deviceAuthorize() : await this.authorize();
      await this.store.set(server, authorized);
      return authorized;
    }
    return current;
  }

  private useDeviceCode(): boolean {
      const flow = this.config.auth?.flow ?? "auto";
      if (flow === "device-code") return true;
      return flow === "auto" && Boolean(this.config.auth?.deviceCodeEndpoint);
    }

    private async deviceAuthorize(): Promise<Tokens> {
      const auth = this.config.auth!;
      if (!auth.deviceCodeEndpoint) throw new Error(`${this.server} device-code flow requires auth.deviceCodeEndpoint`);
      const response = await fetch(auth.deviceCodeEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: formBody({ client_id: this.config.clientId!, scope: (this.config.scopes ?? []).join(" ") }),
      });
      if (!response.ok) throw new Error(`${this.server} device-code request failed with HTTP ${response.status}: ${await response.text()}`);
      const value = await response.json() as Record<string, unknown>;
      const deviceCode = typeof value.device_code === "string" ? value.device_code : undefined;
      const verificationUri = typeof value.verification_uri_complete === "string"
        ? value.verification_uri_complete
        : typeof value.verification_uri === "string" ? value.verification_uri : undefined;
      if (!deviceCode || !verificationUri || typeof value.expires_in !== "number") {
        throw new Error(`${this.server} device-code response was missing required fields`);
      }
      const userCode = typeof value.user_code === "string" ? value.user_code : "";
      console.error(`${this.server}: sign in at ${verificationUri}${userCode ? ` (code: ${userCode})` : ""}`);
      openBrowser(verificationUri);
      const interval = Math.max(1, typeof value.interval === "number" ? value.interval : 5);
      const deadline = Date.now() + value.expires_in * 1000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
        const tokenResponse = await fetch(auth.tokenEndpoint!, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: formBody({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
            client_id: this.config.clientId!,
          }),
        });
        const tokenValue = await tokenResponse.json() as Record<string, unknown>;
        if (tokenResponse.ok) return this.parseTokenResponse(tokenValue);
        if (tokenValue.error === "authorization_pending") continue;
        if (tokenValue.error === "slow_down") {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw new Error(`${this.server} device-code authorization failed: ${typeof tokenValue.error_description === "string" ? tokenValue.error_description : JSON.stringify(tokenValue)}`);
      }
      throw new Error(`${this.server} device-code authorization expired`);
    }
  async set(server: string, tokens: Tokens): Promise<void> {
    if (server === this.server) await this.store.set(server, tokens);
  }

  private async clientSecret(): Promise<string | undefined> {
    const stored = await this.store.get(this.server);
    if (stored?.clientSecret) return stored.clientSecret;
    const key = `MCP_OAUTH_PROXY_CLIENT_SECRET_${this.server.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
    return process.env[key];
  }

  private async refresh(refreshToken: string): Promise<Tokens> {
    const response = await fetch(this.config.auth!.tokenEndpoint!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formBody({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId!,
        ...((await this.clientSecret()) ? { client_secret: (await this.clientSecret())! } : {}),
      }),
    });
    if (!response.ok) throw new Error(`${this.server} OAuth refresh failed with HTTP ${response.status}: ${await response.text()}`);
    return this.parseTokenResponse(await response.json(), refreshToken);
  }

  private async authorize(): Promise<Tokens> {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(24));
    const callback = await this.listenForCallback(state);
    const authorization = new URL(this.config.auth!.authorizationEndpoint!);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", this.config.clientId!);
    authorization.searchParams.set("redirect_uri", callback.redirectUri);
    authorization.searchParams.set("scope", (this.config.scopes ?? []).join(" "));
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");

    openBrowser(authorization.toString());
    const code = await callback.code;
    const response = await fetch(this.config.auth!.tokenEndpoint!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: formBody({
        grant_type: "authorization_code",
        code,
        client_id: this.config.clientId!,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier,
        ...((await this.clientSecret()) ? { client_secret: (await this.clientSecret())! } : {}),
      }),
    });
    if (!response.ok) throw new Error(`${this.server} OAuth exchange failed with HTTP ${response.status}: ${await response.text()}`);
    return this.parseTokenResponse(await response.json());
  }

  private parseTokenResponse(value: any, previousRefreshToken?: string): Tokens {
    if (!value || typeof value.access_token !== "string") {
      throw new Error(`${this.server} OAuth response did not contain access_token`);
    }
    return {
      accessToken: value.access_token,
      refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : previousRefreshToken,
      expiresAt: typeof value.expires_in === "number" ? Date.now() + value.expires_in * 1000 : undefined,
    };
  }

  private listenForCallback(state: string): Promise<{ redirectUri: string; code: Promise<string> }> {
    let resolveCode!: (value: string) => void;
    let rejectCode!: (reason: Error) => void;
    const code = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth/callback") {
        response.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid OAuth state");
        rejectCode(new Error(`${this.server} OAuth state validation failed`));
        server.close();
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        response.writeHead(400).end(`OAuth failed: ${error}`);
        rejectCode(new Error(`${this.server} OAuth authorization failed: ${error}`));
        server.close();
        return;
      }
      const authorizationCode = url.searchParams.get("code");
      if (!authorizationCode) {
        response.writeHead(400).end("Missing authorization code");
        rejectCode(new Error(`${this.server} OAuth callback did not contain a code`));
        server.close();
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }).end("Authorization complete. You can close this window.");
      resolveCode(authorizationCode);
      server.close();
    });
    server.on("error", rejectCode);
    const configuredRedirect = this.config.auth?.redirectUri;
    const redirect = configuredRedirect ? new URL(configuredRedirect) : undefined;
    if (redirect && (redirect.protocol !== "http:" || (redirect.hostname !== "127.0.0.1" && redirect.hostname !== "localhost") || redirect.pathname !== "/oauth/callback")) {
      throw new Error(`${this.server} auth.redirectUri must be an http://127.0.0.1 or http://localhost /oauth/callback URL`);
    }
    server.listen(redirect ? Number(redirect.port || 80) : 0, redirect?.hostname ?? "127.0.0.1");
    return new Promise((resolve, reject) => {
      server.once("listening", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error(`${this.server} OAuth callback listener did not start`));
          return;
        }
        resolve({
          redirectUri: redirect?.toString() ?? `http://127.0.0.1:${address.port}/oauth/callback`,
          code,
        });
      });
      server.once("error", reject);
    });
  }
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}
