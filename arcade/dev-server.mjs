// Local preview with working accounts, no Supabase needed: `npm run build && npm run dev`, then open
// http://localhost:8775/#play. Data lives in memory and resets when the server stops. Invite codes: DEV, DEV2.
// Sign-in skips the email: joining or signing in logs you straight in.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,join,normalize,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHandlers} from './server/handlers.mjs';
import {createMemoryStore,createMemoryAuth} from './server/memory-store.mjs';
import {createManualProvider,createPaymentProvider} from './server/payments.mjs';
import {createStripeWebhook} from './server/stripe.mjs';
import {paymentDetails} from './server/coins.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'build'),port=Number(process.env.PORT||8775);
const store=createMemoryStore({invites:{DEV:1000,DEV2:1000}}),auth=createMemoryAuth();
// Join with this email to reach /admin.html locally, or set ARCADE_ADMIN_EMAILS.
const admins=String(process.env.ARCADE_ADMIN_EMAILS||'admin@dev.test').split(',');
// Bank details for the shop. Real ARCADE_PAY_* values are used if they are set; otherwise obvious local
// placeholders, so the whole buy -> "Mark paid" -> extra try loop works on this machine without them.
const configured=paymentDetails(process.env);
// ARCADE_PAYMENT_PROVIDER=stripe with real test keys runs the card flow against Stripe's test mode on this
// machine: point `stripe listen --forward-to localhost:8775/api/stripe` at it and the webhook grants the
// coins exactly as it does in production. Anything else is the bank-transfer provider, with obvious local
// placeholders if ARCADE_PAY_* is not set, so the whole buy -> "Mark paid" -> extra try loop works offline.
const payments=String(process.env.ARCADE_PAYMENT_PROVIDER||'manual').trim().toLowerCase()==='stripe'
  ?createPaymentProvider(process.env)
  :createManualProvider(configured.ready?configured:{accountName:'Peak Haven Dev',bsb:'000-000',
    accountNumber:'12345678',payId:'dev@peak.test',instruction:'Local dev only. No payment is taken.',ready:true});
const api=createHandlers({store,auth,secret:process.env.RUN_SEED_SECRET||'local-dev-secret',admins,payments});
const stripeHook=createStripeWebhook({store,providerId:payments.id});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.wav':'audio/wav','.ttf':'font/ttf','.woff2':'font/woff2'};

async function body(req){let raw='';for await(const chunk of req)raw+=chunk;try{return raw?JSON.parse(raw):{};}catch{return {};}}
// The webhook is signed over the bytes as sent, so they are read as bytes and never parsed first.
async function rawBody(req){const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return chunks.length?Buffer.concat(chunks):null;}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};

createServer(async(req,res)=>{
  let url;try{url=new URL(req.url,`http://${req.headers.host}`);}catch{res.writeHead(400);res.end('Bad request');return;}
  if(url.pathname.startsWith('/api/')){
    const name=url.pathname.slice(5),token=String(req.headers.authorization||'').replace(/^Bearer /,'')||null;
    if(name==='config')return send(res,200,{accounts:true,dev:true});
    // Before anything parses a body: the signature is checked against the raw request, exactly as /api/stripe
    // does in production.
    if(name==='stripe'){
      if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
      try{
        const out=await stripeHook({body:await rawBody(req),signature:req.headers['stripe-signature']});
        return send(res,out.status,out.body);
      }catch(error){console.error(error);return send(res,500,{error:String(error.message)});}
    }
    let data;try{data=req.method==='POST'?await body(req):{};}catch{res.destroy();return;}
    if(name==='dev-login'){const t=auth.tokenFor(String(data.email||'').trim().toLowerCase());return t?send(res,200,{devToken:t}):send(res,404,{error:'No account uses that email yet. Join with your invite code.'});}
    if(!['join','me','profile','start','finish','leaderboard','results','finalise','buy','admin','money'].includes(name))return send(res,404,{error:'Not found'});
    try{
      const out=await api[name]({token,body:data,query:Object.fromEntries(url.searchParams),origin:`http://${req.headers.host}/`,method:req.method});
      if(name==='join'&&out.status===200)out.body.devToken=auth.tokenFor(String(data.email).trim().toLowerCase());
      return send(res,out.status,out.body);
    }catch(error){console.error(error);return send(res,500,{error:String(error.message)});}
  }
  // The path build sits inside the try: a malformed percent-escape makes decodeURIComponent throw, which reached
  // the server as an unhandled rejection and stopped it. index.html is appended while the path still has its URL
  // slashes, because on Windows normalize() rewrites a trailing slash to a backslash before endsWith('/') sees it.
  try{
    let path=decodeURIComponent(url.pathname);
    if(path.endsWith('/'))path+='index.html';
    path=normalize(path).replace(/^(\.\.[/\\])+/,'');
    const file=join(root,path);
    if(!(await stat(file)).isFile())throw 0;
    const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch(error){
    const malformed=error instanceof URIError;
    res.writeHead(malformed?400:404);res.end(malformed?'Bad request':'Not found');
  }
}).listen(port,()=>{
  console.log(`PH Arcade dev server with accounts: http://localhost:${port}/#play (invite code DEV)`);
  console.log(`Coin shop: ${payments.id==='stripe'
    ?`Stripe${payments.ready?'':' (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing, so the shop is hidden)'}, webhook at /api/stripe`
    :configured.ready?'bank transfer, using ARCADE_PAY_* from the environment':'bank transfer, using local placeholder bank details'}. Admin: ${admins.join(', ')}`);
});
