import { ProxyConfig } from "./config.js";
import { HttpMcpTransport, Rpc } from "./transport.js";
import { TokenProvider } from "./token-store.js";
export class ProxyRouter {
  private readonly transports:Record<string,HttpMcpTransport>={};
  constructor(private readonly config:ProxyConfig, tokens:TokenProvider){ for(const [n,c] of Object.entries(config.servers)) this.transports[n]=new HttpMcpTransport(c,tokens,n); }
  private target(params:any, toolName?:string):{server:string; name?:string} { const server=params?.server; if(server && this.transports[server]) return {server,name:params.name??toolName}; if(toolName?.includes("/")){const [s,...rest]=toolName.split("/"); if(this.transports[s])return {server:s,name:rest.join("/")};} if(Object.keys(this.transports).length===1)return {server:Object.keys(this.transports)[0],name:toolName}; throw new Error("upstream server is required (use params.server or server/tool name)"); }
  async handle(rpc:Rpc):Promise<any>{
    if(rpc.method==="initialize") return {jsonrpc:"2.0",id:rpc.id,result:{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"salesforce-mcp",version:"0.1.0"}}};
    if(rpc.method==="notifications/initialized") return undefined;
    if(rpc.method==="tools/list") { const selected=rpc.params?.server? [rpc.params.server]:Object.keys(this.transports); const tools:any[]=[]; for(const s of selected){if(!this.transports[s])throw new Error(`unknown upstream server: ${s}`); const result=await this.transports[s].request({jsonrpc:"2.0",id:rpc.id??1,method:"tools/list",params:rpc.params}); for(const t of result?.result?.tools??[]) tools.push({...t,name:`${s}/${t.name}`});} return {jsonrpc:"2.0",id:rpc.id,result:{tools}}; }
    if(rpc.method==="tools/call") { const target=this.target(rpc.params,rpc.params?.name); if(!target.name)throw new Error("tool name is required"); const result=await this.transports[target.server].request({jsonrpc:"2.0",id:rpc.id??1,method:"tools/call",params:{...rpc.params,name:target.name,server:undefined}}); return {...result,id:rpc.id}; }
    throw new Error(`unsupported method: ${rpc.method}`);
  }
}
