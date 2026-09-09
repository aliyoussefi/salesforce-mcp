export type Transport = "streamable-http" | "sse";
export type AuthFlow = "auto" | "browser" | "device-code";
export interface ServerConfig {
    endpoint: string;
    transport: Transport;
    clientId?: string;
    scopes?: string[];
    auth?: {
        flow?: AuthFlow;
        issuer?: string;
        authorizationEndpoint?: string;
        tokenEndpoint?: string;
        deviceCodeEndpoint?: string;
        redirectUri?: string;
    };
    tokens?: {
        file?: string;
        allowPlaintextRefreshToken?: boolean;
    };
    headers?: Record<string, string>;
}
export interface ProxyConfig {
    servers: Record<string, ServerConfig>;
}
export declare function validateConfig(value: unknown): ProxyConfig;
export declare function loadConfig(file: string): ProxyConfig;
export declare function expandHome(file: string): string;
export declare function selectServer(config: ProxyConfig, name: string): ProxyConfig;
