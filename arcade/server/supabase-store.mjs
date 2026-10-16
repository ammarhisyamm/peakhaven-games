// Supabase versions of the store and auth interfaces used by handlers.mjs.
import {createClient} from '@supabase/supabase-js';
import {MonthEndNotReady,tableMissing} from './competition.mjs';

export function supabaseEnv(env=process.env){
  const url=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=env.SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
  // Whoever runs the competition, and so can see and finalise monthly results.
  const admins=String(env.ARCADE_ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean);
  return {url,anonKey,serviceKey,secret:env.RUN_SEED_SECRET,admins,ready:Boolean(url&&anonKey&&serviceKey&&env.RUN_SEED_SECRET)};
}

const must=({data,error})=>{if(error)throw new Error(error.message);return data;};
// For the month-end tables only: a read falls back when the migration has not run, a write says so.
const optional=({data,error},fallback)=>{if(!error)return data??fallback;if(tableMissing(error))return fallback;throw new Error(error.message);};
const needsTable=({data,error})=>{if(!error)return data;if(tableMissing(error))throw new MonthEndNotReady();throw new Error(error.message);};

export function createSupabaseBackend(env=supabaseEnv()){
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(env.url,env.serviceKey,options),pub=createClient(env.url,env.anonKey,options);
  const RUN_FIELDS='id,player_id,game,day,seed,level,segments,score,status,flagged,reject_reason,replays,started_at,updated_at,finished_at';
  const run=r=>r&&{...r,seed:Number(r.seed)};

  const store={
    async inviteAvailable(code){const d=must(await admin.from('invites').select('uses,max_uses').eq('code',code).maybeSingle());return Boolean(d&&d.uses<d.max_uses);},
    async useInvite(code){return must(await admin.rpc('use_invite',{p_code:code}))===true;},
    async createPlayer(p){return must(await admin.from('players').insert(p).select().single());},
    async getPlayer(id){return must(await admin.from('players').select('id,name,bottle').eq('id',id).maybeSingle());},
    async updatePlayer(id,patch){return must(await admin.from('players').update(patch).eq('id',id).select('id,name,bottle').single());},
    async playersByIds(ids){if(!ids.length)return [];return must(await admin.from('players').select('id,name,bottle').in('id',ids));},
    async countRuns(playerId,day){const out={};for(const r of must(await admin.from('runs').select('game').eq('player_id',playerId).eq('day',day)))out[r.game]=(out[r.game]||0)+1;return out;},
    async startRun({playerId,game,day,seed,limit,requestId=null}){const rows=must(await admin.rpc('start_run',{p_player:playerId,p_game:game,p_day:day,p_seed:seed,p_limit:limit,...(requestId?{p_request:requestId}:{})}));return run(rows?.[0])??null;},
    async getRun(id){if(!/^[0-9a-f-]{36}$/i.test(id))return null;return run(must(await admin.from('runs').select(RUN_FIELDS).eq('id',id).maybeSingle()));},
    // Compare-and-set on `segments` and `status`, so the same submission can't be counted twice.
    async updateRunIf(id,segments,patch){const rows=must(await admin.from('runs').update(patch).eq('id',id).eq('segments',segments).eq('status','open').select('id'));return rows.length?rows[0]:null;},
    async finishedScores(playerId){
      const out=[];
      for(let page=0;;page++){
        const rows=must(await admin.from('runs').select('score').eq('player_id',playerId).eq('status','closed').order('id').range(page*1000,page*1000+999));
        out.push(...rows.map(r=>Number(r.score)||0));if(rows.length<1000)return out;
      }
    },
    // A finished month's archived podium. Written once an admin finalises it, and replaced if they finalise again
    // after a disqualification, so the three winner rows always match the podium on show.
    async monthResults(month){return optional(await admin.from('month_results').select('month,game,rank,player_id,score,winner,finalised_at').eq('month',month).order('game').order('rank'),[]).map(r=>({...r,score:Number(r.score)||0}));},
    async saveMonthResults(month,rows){
      needsTable(await admin.from('month_results').delete().eq('month',month));
      if(rows.length)needsTable(await admin.from('month_results').insert(rows.map(r=>({month,game:r.game,rank:r.rank,player_id:r.player_id,score:r.score,winner:r.winner}))));
      return this.monthResults(month);
    },
    async finalisedMonths(){return [...new Set(optional(await admin.from('month_results').select('month').order('month'),[]).map(r=>r.month))];},
    async prizes(){return Object.fromEntries(optional(await admin.from('month_prizes').select('game,text'),[]).map(r=>[r.game,r.text??'']));},
    async setPrize(game,text){needsTable(await admin.from('month_prizes').upsert({game,text,updated_at:new Date().toISOString()},{onConflict:'game'}));return text;},
    // Whether the month-end migration has run. Checked before finalising, and shown on the admin page.
    async monthEndReady(){
      for(const table of ['month_results','month_prizes']){
        const {error}=await admin.from(table).select('game',{head:true,count:'exact'});
        if(error){if(tableMissing(error))return false;throw new Error(error.message);}
      }
      return true;
    },
    async scoredRuns(from,to){
      const out=[];
      for(let page=0;;page++){
        const rows=must(await admin.from('runs').select('id,player_id,game,score,day,updated_at').neq('status','rejected').gt('score',0).gte('day',from).lte('day',to).order('id').range(page*1000,page*1000+999));
        out.push(...rows);if(rows.length<1000)return out;
      }
    },
  };

  const auth={
    async userFromToken(token){const {data,error}=await admin.auth.getUser(token);return error||!data?.user?null:{id:data.user.id,email:data.user.email};},
    async createUser(email){
      const {data,error}=await admin.auth.admin.createUser({email,email_confirm:true});
      if(!error)return {id:data.user.id};
      if(error.code==='email_exists'||/already/i.test(error.message))return {exists:true};
      throw new Error(error.message);
    },
    async deleteUser(id){await admin.auth.admin.deleteUser(id);},
    async sendLink(email,redirectTo){must(await pub.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirectTo}}));},
    // Admin only: the addresses the prizes are sent to. Emails live in auth, not in the players table.
    async emailsByIds(ids){
      const out=[];
      for(const id of ids){const {data,error}=await admin.auth.admin.getUserById(id);if(!error&&data?.user?.email)out.push({id,email:data.user.email});}
      return out;
    },
  };
  return {store,auth};
}
