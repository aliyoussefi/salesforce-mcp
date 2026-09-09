import fs from "node:fs";
import readline from "node:readline";
import { loadConfig } from "./config.js";
import { FileTokenStore } from "./token-store.js";
import { OAuthTokenProvider } from "./oauth-provider.js";
import { ProxyRouter } from "./proxy.js";
import { runSetup } from "./setup.js";
import { salesforceConfig } from "./salesforce-config.js";
const setup = process.argv.includes("--setup");
const arg=process.argv.indexOf("--config"); const file=arg>=0?process.argv[arg+1]:undefined;
if (setup) {
  await runSetup(file ?? "config.json");
  process.exit(0);
}
const config=file ? loadConfig(file) : salesforceConfig;
const defaultFile=process.env.MCP_OAUTH_PROXY_TOKEN_FILE??"~/.mcp-oauth-proxy/tokens.json";
const store=new FileTokenStore(Object.fromEntries(Object.entries(config.servers).map(([name,c])=>[name,c.tokens?.file??defaultFile])),false);
const providers: Record<string, OAuthTokenProvider> = {};
for(const [name, server] of Object.entries(config.servers)) {
  const env=`MCP_OAUTH_PROXY_TOKEN_${name.replace(/[^A-Za-z0-9]/g,"_").toUpperCase()}`;
  const token=process.env[env];
  if(token) await store.set(name,{accessToken:token});
  providers[name]=new OAuthTokenProvider(name, server, store);
}
const tokenProvider = {
  get: async (name: string) => providers[name]?.get(name),
  set: async (name: string, tokens: import("./token-store.js").Tokens) => providers[name]?.set(name, tokens),
};
const router=new ProxyRouter(config,tokenProvider); const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
function write(v:any){process.stdout.write(JSON.stringify(v)+"\n");}
rl.on("line",async line=>{if(!line.trim())return; try{const rpc=JSON.parse(line); if(!rpc.id && rpc.method?.startsWith("notifications/")) {await router.handle(rpc);return;} const result=await router.handle(rpc); if(result!==undefined)write(result);}catch(e:any){const rpc=(()=>{try{return JSON.parse(line)}catch{return {}}})(); write({jsonrpc:"2.0",id:rpc.id??null,error:{code:-32000,message:e?.message??String(e)}});}});
rl.on("close",()=>process.exit(0));
