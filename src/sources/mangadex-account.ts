import {z}from'zod';
import {SafeHttp}from'./http.js';
import {SourceError}from'../shared/types.js';
export interface AccountVault{get(key:string):Promise<string>;put(key:string,value:string):Promise<void>;remove(key:string):Promise<void>}
export const accountLoginSchema=z.object({clientId:z.string().min(1).max(256).regex(/^personal-client-/),clientSecret:z.string().min(1).max(4096),username:z.string().min(1).max(256),password:z.string().min(1).max(256)}).strict();
interface Session{clientId:string;clientSecret:string;accessToken:string;refreshToken:string;expires:number;username:string}
export interface AccountStatus{connected:boolean;username?:string;message?:string}
const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.number().positive().max(86400).default(900)});
const endpoint='https://auth.mangadex.org/realms/mangadex/protocol/openid-connect/token';
export class MangaDexAccount{
  private session?:Session;private loaded=false;private busy=false;
  constructor(private vault:AccountVault,private http:Pick<SafeHttp,'get'>=new SafeHttp(1000)){}
  private async token(form:URLSearchParams){try{return tokenSchema.parse(JSON.parse((await this.http.get(endpoint,['auth.mangadex.org'],undefined,false,{form})).toString()));}catch(e){if(e instanceof SourceError&&e.kind==='transient')throw new SourceError('MangaDex login service is temporarily unavailable.');throw new SourceError('MangaDex login failed. Verify the approved personal-client ID, client secret and owner credentials.','action_required');}}
  private async persist(){await this.vault.put('mangadex-account',JSON.stringify(this.session));}
  private async profile(token:string){try{const bytes=await this.http.get('https://api.mangadex.org/user/me',['api.mangadex.org'],undefined,false,{bearer:token});return z.object({data:z.object({attributes:z.object({username:z.string()})})}).parse(JSON.parse(bytes.toString())).data.attributes.username;}catch{throw new SourceError('MangaDex could not verify this account. Sign in again.','action_required');}}
  async connect(input:unknown):Promise<AccountStatus>{if(this.busy)throw new SourceError('An account operation is already running.');this.busy=true;try{const d=accountLoginSchema.parse(input);const token=await this.token(new URLSearchParams({grant_type:'password',client_id:d.clientId,client_secret:d.clientSecret,username:d.username,password:d.password}));if(!token.refresh_token)throw new SourceError('MangaDex did not provide a refresh token.');const username=await this.profile(token.access_token);const next={clientId:d.clientId,clientSecret:d.clientSecret,accessToken:token.access_token,refreshToken:token.refresh_token,expires:Date.now()+token.expires_in*1000,username};await this.vault.put('mangadex-account',JSON.stringify(next));this.session=next;this.loaded=true;return{connected:true,username};}catch(e){if(e instanceof z.ZodError)throw new SourceError('Enter your approved personal-client ID, secret, username and password.');throw e;}finally{this.busy=false;}}
  async status():Promise<AccountStatus>{try{if(!this.loaded){this.loaded=true;try{const raw=JSON.parse(await this.vault.get('mangadex-account'));this.session=z.object({clientId:z.string(),clientSecret:z.string(),accessToken:z.string(),refreshToken:z.string(),expires:z.number(),username:z.string()}).parse(raw);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return{connected:false,message:'Stored account could not be read. Sign in locally again.'};}}
    if(!this.session)return{connected:false};if(this.busy)return{connected:false,message:'Account operation in progress.'};
    if(this.session.expires<Date.now()+60000){this.busy=true;try{const t=await this.token(new URLSearchParams({grant_type:'refresh_token',client_id:this.session.clientId,client_secret:this.session.clientSecret,refresh_token:this.session.refreshToken}));this.session={...this.session,accessToken:t.access_token,refreshToken:t.refresh_token??this.session.refreshToken,expires:Date.now()+t.expires_in*1000};this.session.username=await this.profile(t.access_token);await this.persist();}finally{this.busy=false;}}
    return{connected:true,username:this.session.username};
  }catch{return{connected:false,message:'MangaDex session needs attention. Sign in locally again; public downloads still work.'};}}
  async disconnect():Promise<AccountStatus>{if(this.busy)throw new SourceError('An account operation is already running.');await this.vault.remove('mangadex-account');this.session=undefined;this.loaded=true;return{connected:false};}
}
