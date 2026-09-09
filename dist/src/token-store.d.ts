export interface Tokens {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    clientSecret?: string;
}
export interface TokenProvider {
    get(server: string): Promise<Tokens | undefined>;
    set(server: string, tokens: Tokens): Promise<void>;
}
export declare class FileTokenStore implements TokenProvider {
    private readonly file;
    private readonly allowPlaintextRefreshToken;
    constructor(file: string | Record<string, string>, allowPlaintextRefreshToken?: boolean);
    private pathFor;
    private read;
    private crypt;
    get(server: string): Promise<{
        refreshToken: string | undefined;
        clientSecret: string | undefined;
        accessToken?: string;
        expiresAt?: number;
    } | undefined>;
    set(server: string, t: Tokens): Promise<void>;
}
