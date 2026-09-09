import { ServerConfig } from "./config.js";
import { TokenProvider, Tokens } from "./token-store.js";
export declare class OAuthTokenProvider implements TokenProvider {
    private readonly server;
    private readonly config;
    private readonly store;
    constructor(server: string, config: ServerConfig, store: TokenProvider);
    get(server: string): Promise<Tokens | undefined>;
    private useDeviceCode;
    private deviceAuthorize;
    set(server: string, tokens: Tokens): Promise<void>;
    private clientSecret;
    private refresh;
    private authorize;
    private parseTokenResponse;
    private listenForCallback;
}
