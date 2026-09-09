import fs from "node:fs";
import path from "node:path";
export function validateConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("config must be an object");
    const servers = value.servers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers) || !Object.keys(servers).length)
        throw new Error("servers must be a non-empty object");
    for (const [name, c] of Object.entries(servers)) {
        if (!/^[A-Za-z0-9._-]+$/.test(name))
            throw new Error(`invalid server name: ${name}`);
        const x = c;
        if (!x || typeof x.endpoint !== "string" || !/^https?:\/\//i.test(x.endpoint))
            throw new Error(`${name}.endpoint must be an http(s) URL`);
        if (x.transport !== "streamable-http" && x.transport !== "sse")
            throw new Error(`${name}.transport must be streamable-http or sse`);
        if (x.scopes !== undefined && (!Array.isArray(x.scopes) || x.scopes.some((s) => typeof s !== "string")))
            throw new Error(`${name}.scopes must be strings`);
    }
    return value;
}
export function loadConfig(file) { return validateConfig(JSON.parse(fs.readFileSync(file, "utf8"))); }
export function expandHome(file) { return file.startsWith("~") ? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", file.slice(2)) : file; }
export function selectServer(config, name) {
    if (!config.servers[name])
        throw new Error(`unknown server: ${name}`);
    return { ...config, servers: { [name]: config.servers[name] } };
}
