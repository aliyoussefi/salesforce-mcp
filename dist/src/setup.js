import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { FileTokenStore } from "./token-store.js";
async function ask(rl, question, defaultValue) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const value = (await rl.question(`${question}${suffix}: `)).trim();
    return value || defaultValue || "";
}
async function discover(endpoint) {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const challenge = response.headers.get("www-authenticate") ?? "";
    const metadataMatch = challenge.match(/resource_metadata="([^"]+)"/i);
    const candidates = metadataMatch ? [metadataMatch[1]] : [];
    const origin = new URL(endpoint).origin;
    candidates.push(`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/openid-configuration`);
    for (const url of candidates) {
        try {
            const metadataResponse = await fetch(url);
            if (!metadataResponse.ok)
                continue;
            const metadata = await metadataResponse.json();
            const authorizationServers = Array.isArray(metadata.authorization_servers)
                ? metadata.authorization_servers.filter((v) => typeof v === "string")
                : [];
            const issuer = typeof metadata.issuer === "string" ? metadata.issuer : authorizationServers[0];
            if (issuer && !metadata.authorization_endpoint && !metadata.token_endpoint) {
                for (const suffix of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"]) {
                    const nested = await fetch(`${issuer.replace(/\/$/, "")}${suffix}`);
                    if (nested.ok)
                        Object.assign(metadata, await nested.json());
                }
            }
            return {
                authorizationEndpoint: typeof metadata.authorization_endpoint === "string" ? metadata.authorization_endpoint : undefined,
                tokenEndpoint: typeof metadata.token_endpoint === "string" ? metadata.token_endpoint : undefined,
                scopes: Array.isArray(metadata.scopes_supported)
                    ? metadata.scopes_supported.filter((v) => typeof v === "string")
                    : undefined,
            };
        }
        catch {
            // Try the next standard discovery location.
        }
    }
    return {};
}
function writeConfig(file, config) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}${os.EOL}`, "utf8");
}
export async function runSetup(file) {
    const rl = readline.createInterface({ input, output });
    try {
        console.log("MCP OAuth Proxy setup");
        console.log("This creates a config file. It never asks for or stores your password or tokens.");
        const existing = fs.existsSync(file) ? loadConfig(file) : { servers: {} };
        const serverName = await ask(rl, "Name for this MCP server", "dataverse");
        const endpoint = await ask(rl, "MCP server URL");
        if (!endpoint)
            throw new Error("An MCP server URL is required.");
        const transport = (await ask(rl, "Transport (streamable-http or sse)", "streamable-http"));
        if (transport !== "streamable-http" && transport !== "sse")
            throw new Error("Transport must be streamable-http or sse.");
        console.log("Checking the server for OAuth settings...");
        const discovery = await discover(endpoint);
        const authorizationEndpoint = await ask(rl, "Authorization URL", discovery.authorizationEndpoint);
        const tokenEndpoint = await ask(rl, "Token URL", discovery.tokenEndpoint);
        const clientId = await ask(rl, "Public OAuth client ID");
        const clientSecret = await ask(rl, "OAuth client secret (stored encrypted; leave blank if not required)");
        const discoveredScopes = discovery.scopes?.join(" ");
        const scopeText = await ask(rl, "OAuth scopes (space-separated)", discoveredScopes);
        const flowChoice = await ask(rl, "Sign-in method (auto, browser, or device-code)", "auto");
        if (flowChoice !== "auto" && flowChoice !== "browser" && flowChoice !== "device-code") {
            throw new Error("Sign-in method must be auto, browser, or device-code.");
        }
        const deviceCodeEndpoint = await ask(rl, "Device-code URL (optional)");
        const redirectUri = flowChoice === "device-code"
            ? undefined
            : await ask(rl, "Browser callback URL", "http://localhost:8765/oauth/callback");
        if (!tokenEndpoint || !clientId || (flowChoice === "browser" && !authorizationEndpoint) ||
            (flowChoice === "device-code" && !deviceCodeEndpoint) ||
            (flowChoice === "auto" && !authorizationEndpoint && !deviceCodeEndpoint) ||
            (flowChoice !== "device-code" && !redirectUri)) {
            throw new Error("Token URL and public client ID are required. Browser flow needs an authorization URL; device-code flow needs a device-code URL.");
        }
        const config = {
            servers: {
                ...existing.servers,
                [serverName]: {
                    endpoint,
                    transport,
                    clientId,
                    scopes: scopeText ? scopeText.split(/\s+/) : [],
                    auth: {
                        flow: flowChoice,
                        authorizationEndpoint,
                        tokenEndpoint,
                        ...(deviceCodeEndpoint ? { deviceCodeEndpoint } : {}),
                        ...(redirectUri ? { redirectUri } : {}),
                    },
                    tokens: { file: `~/.mcp-oauth-proxy/${serverName}-tokens.json` },
                },
            },
        };
        writeConfig(file, config);
        if (clientSecret) {
            const tokenFile = `~/.mcp-oauth-proxy/${serverName}-tokens.json`;
            await new FileTokenStore(tokenFile, false).set(serverName, { clientSecret });
        }
        console.log(`Saved configuration to ${file}`);
        console.log("The first Scout tools/list call will open a browser for sign-in.");
    }
    finally {
        rl.close();
    }
}
