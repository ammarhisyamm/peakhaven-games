// Adapts handlers.mjs to Vercel's Node functions: api/<name>.js -> route('<name>').
import {createHandlers} from './handlers.mjs';
import {supabaseEnv,createSupabaseBackend} from './supabase-store.mjs';

let handlers=null;
function setup(){
  if(handlers)return handlers;
  const env=supabaseEnv();
  if(!env.ready)return null;
  const {store,auth}=createSupabaseBackend(env);
  handlers=createHandlers({store,auth,secret:env.secret});
  return handlers;
}
const METHODS={join:'POST',me:'GET',profile:'POST',start:'POST',finish:'POST',leaderboard:'GET'};

export function route(name){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    if(req.method!==METHODS[name])return res.status(405).json({error:'Method not allowed'});
    const api=setup();
    if(!api)return res.status(503).json({error:'Accounts are not set up on this deployment yet.'});
    const header=String(req.headers.authorization||''),token=header.startsWith('Bearer ')?header.slice(7):null;
    let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body);}catch{body=null;}}
    const origin=`https://${req.headers['x-forwarded-host']||req.headers.host}/`;
    try{
      const out=await api[name]({token,body:body??{},query:req.query??{},origin});
      return res.status(out.status).json(out.body);
    }catch(error){
      console.error(`[api/${name}]`,error);
      return res.status(500).json({error:'Something went wrong. Please try again.'});
    }
  };
}

// Public settings the browser needs to sign in. Empty when accounts aren't configured, so the site runs in demo mode.
export function config(){
  return function handler(req,res){
    const env=supabaseEnv();
    res.setHeader('Cache-Control','no-store');
    res.status(200).json(env.ready?{accounts:true,supabaseUrl:env.url,supabaseAnonKey:env.anonKey}:{accounts:false});
  };
}
