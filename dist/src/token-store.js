import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./config.js";
async function dpapi(mode, input) {
    const script = `$i=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); Add-Type -AssemblyName System.Security; $p=[System.Security.Cryptography.ProtectedData]::${mode === "protect" ? "Protect" : "Unprotect"}($i,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($p)`;
    return await new Promise((resolve, reject) => { const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["pipe", "pipe", "pipe"] }); let out = "", err = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d); p.on("close", c => c === 0 ? resolve(out.trim()) : reject(new Error(err || `DPAPI exited ${c}`))); p.stdin.end(input); });
}
export class FileTokenStore {
    file;
    allowPlaintextRefreshToken;
    constructor(file, allowPlaintextRefreshToken = false) {
        this.file = file;
        this.allowPlaintextRefreshToken = allowPlaintextRefreshToken;
    }
    pathFor(server) { return expandHome(typeof this.file === "string" ? this.file : (this.file[server] ?? "~/.mcp-oauth-proxy/tokens.json")); }
    async read(server = "") { try {
        return JSON.parse(await fs.readFile(this.pathFor(server), "utf8"));
    }
    catch (e) {
        if (e.code === "ENOENT")
            return {};
        throw e;
    } }
    async crypt(mode, text) {
        if (process.platform === "win32") {
            const result = await dpapi(mode === "encrypt" ? "protect" : "unprotect", mode === "encrypt" ? Buffer.from(text, "utf8").toString("base64") : text);
            return mode === "encrypt" ? result : Buffer.from(result, "base64").toString("utf8");
        }
        const keyRaw = process.env.MCP_OAUTH_PROXY_KEY;
        if (!keyRaw)
            throw new Error("MCP_OAUTH_PROXY_KEY is required for non-Windows encrypted token storage");
        const key = Buffer.from(keyRaw, "base64");
        if (key.length !== 32)
            throw new Error("MCP_OAUTH_PROXY_KEY must be 32-byte base64");
        if (mode === "encrypt") {
            const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
            const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
            return `gcm:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${body.toString("base64")}`;
        }
        const [, ivS, tagS, bodyS] = text.split(":");
        const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivS, "base64"));
        d.setAuthTag(Buffer.from(tagS, "base64"));
        return Buffer.concat([d.update(Buffer.from(bodyS, "base64")), d.final()]).toString("utf8");
    }
    async get(server) { const all = await this.read(server), v = all[server]; if (!v)
        return undefined; return { ...v, refreshToken: v.refreshToken ? await this.crypt("decrypt", v.refreshToken) : undefined, clientSecret: v.clientSecret ? await this.crypt("decrypt", v.clientSecret) : undefined }; }
    async set(server, t) { if (t.refreshToken && this.allowPlaintextRefreshToken) { /* explicit unsafe hook */ } const all = await this.read(server); const previous = all[server]; all[server] = { ...t, refreshToken: t.refreshToken ? await this.crypt("encrypt", t.refreshToken) : undefined, clientSecret: t.clientSecret ? await this.crypt("encrypt", t.clientSecret) : previous?.clientSecret }; const f = this.pathFor(server); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(all, null, 2), { mode: 0o600 }); }
}
