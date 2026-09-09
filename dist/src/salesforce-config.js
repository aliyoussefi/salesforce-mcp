export const salesforceConfig = {
    servers: {
        salesforce: {
            endpoint: "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
            transport: "streamable-http",
            clientId: "3MVG9HtWXcDGV.nFjdaXktgRxDHxYHpgbVfGSdw7ebzKax_MF1tVOeenV_iAGSkX5.WV4j2ndSfFWcx_SvrKx",
            scopes: ["api", "sfap_api", "refresh_token", "mcp_api"],
            auth: {
                flow: "browser",
                authorizationEndpoint: "https://login.salesforce.com/services/oauth2/authorize?prompt=select_account",
                tokenEndpoint: "https://login.salesforce.com/services/oauth2/token",
                redirectUri: "http://localhost:8765/oauth/callback",
            },
            tokens: {
                file: "~/.mcp-oauth-proxy/salesforce-tokens.json",
            },
        },
    },
};
