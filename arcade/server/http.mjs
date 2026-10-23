// Adapts handlers.mjs to Vercel's Node functions: api/<name>.js -> route('<name>').
import {createHandlers} from './handlers.mjs';
import {supabaseEnv,createSupabaseBackend} from './supabase-store.mjs';
import {createPaymentProvider} from './payments.mjs';
import {createStripeWebhook} from './stripe.mjs';

let handlers=null;
function setup(){
  if(handlers)return handlers;
  const env=supabaseEnv();
  if(!env.ready)return null;
  const {store,auth}=createSupabaseBackend(env);
  handlers=createHandlers({store,auth,secret:env.secret,admins:env.admins,payments:createPaymentProvider()});
  return handlers;
}
// One or more methods per route. /api/admin answers both: GET is the admin view, POST is an action on it.
const METHODS={join:'POST',me:'GET',profile:'POST',start:'POST',finish:'POST',leaderboard:'GET',results:'GET',finalise:'POST',
  // Paid extra tries: buy is the player asking for a reference to pay, money is admin only.
  buy:'POST',
  // Everything an admin does is one function: GET is the whole view, POST is one action on it.
  // /api/money reaches it too, through the rewrite in arcade/vercel.json.
  admin:['GET','POST'],money:['GET','POST']};
const allows=(name,method)=>[METHODS[name]].flat().includes(method);

export function route(name){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    if(!allows(name,req.method))return res.status(405).json({error:'Method not allowed'});
    const api=setup();
    if(!api)return res.status(503).json({error:'Accounts are not set up on this deployment yet.'});
    const header=String(req.headers.authorization||''),token=header.startsWith('Bearer ')?header.slice(7):null;
    let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body);}catch{body=null;}}
    const origin=`https://${req.headers['x-forwarded-host']||req.headers.host}/`;
    try{
      const out=await api[name]({token,body:body??{},query:req.query??{},origin,method:req.method});
      return res.status(out.status).json(out.body);
    }catch(error){
      console.error(`[api/${name}]`,error);
      return res.status(500).json({error:'Something went wrong. Please try again.'});
    }
  };
}

// Stripe's webhook, and the one reason this deployment has a twelfth function: a signature can only be
// checked against the exact bytes Stripe sent, and every other route here reads req.body, which is a parsed
// object. Vercel's req.body is a lazy getter, so a function that never asks for it leaves the stream
// untouched and can read those bytes itself — which is what rawBody below does.
let hook=null;
export function stripeWebhook(){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const env=supabaseEnv();
    if(!env.ready)return res.status(503).json({error:'Accounts are not set up on this deployment yet.'});
    if(!hook){
      const {store}=createSupabaseBackend(env);
      hook=createStripeWebhook({store,providerId:createPaymentProvider().id});
    }
    try{
      const out=await hook({body:await rawBody(req),signature:req.headers['stripe-signature']});
      return res.status(out.status).json(out.body);
    }catch(error){
      // A 500 is the honest answer: Stripe retries for three days, and the event is not written down until
      // it has actually been acted on, so the retry does the work this attempt did not.
      console.error('[api/stripe]',error);
      return res.status(500).json({error:'The event could not be handled. Please retry.'});
    }
  };
}
// The bytes as sent. Nothing here reads req.body: a parsed object re-serialised is no longer what Stripe
// signed, so if the stream really has been consumed this answers with nothing and the webhook says so rather
// than verifying a signature against a guess.
async function rawBody(req){
  if(Buffer.isBuffer(req.rawBody))return req.rawBody;
  const chunks=[];
  for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  return chunks.length?Buffer.concat(chunks):null;
}

// Public settings the browser needs to sign in. Empty when accounts aren't configured, so the site runs in demo mode.
export function config(){
  return function handler(req,res){
    const env=supabaseEnv();
    res.setHeader('Cache-Control','no-store');
    res.status(200).json(env.ready?{accounts:true,supabaseUrl:env.url,supabaseAnonKey:env.anonKey}:{accounts:false});
  };
}
