import { ProxyConfig } from "./config.js";
import { Rpc } from "./transport.js";
import { TokenProvider } from "./token-store.js";
export declare class ProxyRouter {
    private readonly config;
    private readonly transports;
    constructor(config: ProxyConfig, tokens: TokenProvider);
    private target;
    handle(rpc: Rpc): Promise<any>;
}
