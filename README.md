# Salesforce MCP

Local stdio MCP server for the Salesforce MCP endpoint. It follows the same
distribution model as the MSX MCP: a versioned GitHub repository that Scout
launches through `npx`.

## Build and test

```powershell
npm install
npm test
npm run build:exe
```

The distributable is `dist\salesforce-mcp.exe`.

## Distribution

Publish this repository to GitHub and create a version tag such as `v0.1.0`.
The target machine needs Node.js 20 or later. Scout can then launch the tagged
repository directly:

```json
"salesforce": {
  "builtin": false,
  "config": {
    "name": "Salesforce",
    "type": "command",
    "command": "npx",
    "args": [
      "-y",
      "github:<owner>/<salesforce-mcp-repo>#v0.1.0"
    ],
    "timeout": 300000
  },
  "tools": []
}
```

This is the same launch contract used by MSX. `npx` downloads the tagged
package, installs its dependencies, and runs the `bin` entry in `package.json`.
The repository must be accessible to the target user.

For an npm distribution, publish the package to a registry and replace the
GitHub reference with `@<scope>/salesforce-mcp@0.1.0`.

The first Salesforce request opens browser sign-in. Each user gets a separate
encrypted refresh token at:

```text
C:\Users\<user>\.mcp-oauth-proxy\salesforce-tokens.json
```

If the Connected App requires a secret, set
`MCP_OAUTH_PROXY_CLIENT_SECRET_SALESFORCE` as a per-user environment variable.
Never place the secret in this repository or in the Scout configuration.

The OAuth callback must be registered as:

```text
http://localhost:8765/oauth/callback
```

## Development mode

```powershell
npm start
```

The optional `--config` argument remains available for development overrides.
