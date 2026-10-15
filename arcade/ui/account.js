import {requestJSON} from './network.js';
// Accounts for the competition. Sign-in uses Supabase email links; every competition call goes through /api with
// the signed-in session's token. Without /api/config (a plain static preview) the arcade runs in demo mode.
// Supabase's browser bundle is copied in by build.mjs from the pinned npm package.
function loadSupabase(){return window.supabase?Promise.resolve(window.supabase):new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='vendor/supabase.js';const timer=setTimeout(()=>{s.remove();reject(new Error('Sign-in could not load'));},15000);s.onload=()=>{clearTimeout(timer);resolve(window.supabase);};s.onerror=()=>{clearTimeout(timer);reject(new Error('Sign-in could not load'));};document.head.append(s);});}

export async function initAccount(){
  const cfg=await requestJSON('api/config',{cache:'no-store'});
  if(cfg.status===404)return {enabled:false}; // A static preview has no API.
  if(!cfg.ok||typeof cfg.accounts!=='boolean')throw new Error(cfg.error||'Sign-in settings could not load.');
  if(!cfg.accounts)return {enabled:false};
  // A link that has expired comes back with the reason in the address bar.
  const hash=new URLSearchParams(location.hash.slice(1));
  const linkError=hash.get('error_description');

  let session=null,supabase=null,devToken=null;
  const listeners=new Set(),notify=()=>listeners.forEach(fn=>fn());
  if(cfg.dev){
    try{devToken=localStorage.getItem('ph-dev-token');}catch{}
  }else{
    const {createClient}=await loadSupabase();
    supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)})},auth:{flowType:'implicit',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
    session=(await supabase.auth.getSession()).data.session;
    supabase.auth.onAuthStateChange((_event,next)=>{const changed=Boolean(next)!==Boolean(session);session=next;if(changed)notify();});
  }
  // Leave the sign-in tokens or error out of the address bar and the page router.
  if(hash.has('access_token')||hash.has('error')||hash.has('error_description'))history.replaceState(null,'',`${location.pathname}${location.search}#play`);

  const token=()=>cfg.dev?devToken:session?.access_token??null;
  async function api(name,{body,query}={}){
    const qs=query?`?${new URLSearchParams(query)}`:'';
    const response=await requestJSON(`api/${name}${qs}`,{method:body?'POST':'GET',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token()?{Authorization:`Bearer ${token()}`}:{})},body:body?JSON.stringify(body):undefined});
    if(response.status===401&&token())await signOut(false);
    return response;
  }

  async function join(email,code,name){
    const r=await api('join',{body:{email,code,name}});
    if(r.ok&&cfg.dev&&r.devToken)setDevToken(r.devToken);
    return r;
  }
  async function signIn(email){
    if(cfg.dev){const r=await api('dev-login',{body:{email}});if(r.ok)setDevToken(r.devToken);return r;}
    let error;try{({error}=await supabase.auth.signInWithOtp({email:String(email).trim().toLowerCase(),options:{shouldCreateUser:false,emailRedirectTo:`${location.origin}${location.pathname}`}}));}catch{return {ok:false,error:'Sign-in could not connect. Please try again.'};}
    if(!error)return {ok:true,sent:true};
    return {ok:false,error:/signups not allowed|not found|otp_disabled/i.test(error.message)?'No account uses that email yet. Join with your invite code.':/rate|seconds/i.test(error.message)?'Please wait a minute before asking for another link.':error.message};
  }
  function setDevToken(value){devToken=value;try{value?localStorage.setItem('ph-dev-token',value):localStorage.removeItem('ph-dev-token');}catch{}notify();}
  async function signOut(tell=true){if(cfg.dev)setDevToken(null);else{await supabase.auth.signOut().catch(()=>{});session=null;if(tell)notify();else notify();}}

  return {enabled:true,dev:Boolean(cfg.dev),linkError,signedIn:()=>Boolean(token()),email:()=>session?.user?.email??null,api,join,signIn,signOut,onChange:fn=>listeners.add(fn)};
}
