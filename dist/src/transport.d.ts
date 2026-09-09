import { ServerConfig } from "./config.js";
import { TokenProvider } from "./token-store.js";
export interface Rpc {
    jsonrpc: "2.0";
    id?: string | number | null;
    method: string;
    params?: any;
}
export declare class HttpMcpTransport {
    private readonly config;
    private readonly tokens;
    private readonly server;
    private sessionId?;
    private initialized;
    constructor(config: ServerConfig, tokens: TokenProvider, server: string);
    request(body: Rpc): Promise<any>;
    private requestUpstream;
}
