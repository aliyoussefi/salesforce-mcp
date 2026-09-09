export class HttpMcpTransport {
    config;
    tokens;
    server;
    sessionId;
    initialized = false;
    constructor(config, tokens, server) {
        this.config = config;
        this.tokens = tokens;
        this.server = server;
    }
    async request(body) {
        if (body.method !== "initialize" && !this.initialized) {
            await this.requestUpstream({ jsonrpc: "2.0", id: `proxy-init-${Date.now()}`, method: "initialize", params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "mcp-oauth-proxy", version: "0.1.0" },
                } });
            await this.requestUpstream({ jsonrpc: "2.0", method: "notifications/initialized" });
            this.initialized = true;
        }
        const result = await this.requestUpstream(body);
        if (body.method === "initialize")
            this.initialized = true;
        return result;
    }
    async requestUpstream(body) {
        const t = await this.tokens.get(this.server);
        const headers = { "content-type": "application/json", "accept": "application/json, text/event-stream", "mcp-protocol-version": "2024-11-05", ...(this.config.headers ?? {}) };
        if (t?.accessToken)
            headers.authorization = `Bearer ${t.accessToken}`;
        if (this.sessionId)
            headers["mcp-session-id"] = this.sessionId;
        const response = await fetch(this.config.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
        if (!response.ok)
            throw new Error(`${this.server} upstream HTTP ${response.status}: ${await response.text()}`);
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId)
            this.sessionId = sessionId;
        const type = response.headers.get("content-type") ?? "";
        const text = await response.text();
        if (!text.trim()) {
            if (body.method.startsWith("notifications/"))
                return undefined;
            throw new Error(`${this.server} upstream returned an empty MCP response (content-type: ${type || "unknown"})`);
        }
        if (type.includes("text/event-stream"))
            return parseSse(text);
        return JSON.parse(text);
    }
}
function parseSse(text) { const lines = text.split(/\r?\n/), data = lines.filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("\n"); if (!data)
    throw new Error("upstream SSE response contained no data"); return JSON.parse(data); }
