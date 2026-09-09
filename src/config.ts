import fs from "node:fs";
import path from "node:path";

export type Transport = "streamable-http" | "sse";
export type AuthFlow = "auto" | "browser" | "device-code";
export interface ServerConfig { endpoint: string; transport: Transport; clientId?: string; scopes?: string[]; auth?: { flow?: AuthFlow; issuer?: string; authorizationEndpoint?: string; tokenEndpoint?: string; deviceCodeEndpoint?: string; redirectUri?: string }; tokens?: { file?: string; allowPlaintextRefreshToken?: boolean }; headers?: Record<string,string>; }
export interface ProxyConfig { servers: Record<string, ServerConfig>; }
export function validateConfig(value: unknown): ProxyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config must be an object");
  const servers = (value as any).servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers) || !Object.keys(servers).length) throw new Error("servers must be a non-empty object");
  for (const [name, c] of Object.entries(servers)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`invalid server name: ${name}`);
    const x = c as any;
    if (!x || typeof x.endpoint !== "string" || !/^https?:\/\//i.test(x.endpoint)) throw new Error(`${name}.endpoint must be an http(s) URL`);
    if (x.transport !== "streamable-http" && x.transport !== "sse") throw new Error(`${name}.transport must be streamable-http or sse`);
    if (x.scopes !== undefined && (!Array.isArray(x.scopes) || x.scopes.some((s:any)=>typeof s !== "string"))) throw new Error(`${name}.scopes must be strings`);
  }
  return value as ProxyConfig;
}
export function loadConfig(file: string): ProxyConfig { return validateConfig(JSON.parse(fs.readFileSync(file, "utf8"))); }
export function expandHome(file: string): string { return file.startsWith("~") ? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", file.slice(2)) : file; }
export function selectServer(config: ProxyConfig, name: string): ProxyConfig {
  if (!config.servers[name]) throw new Error(`unknown server: ${name}`);
  return { ...config, servers: { [name]: config.servers[name] } };
}
