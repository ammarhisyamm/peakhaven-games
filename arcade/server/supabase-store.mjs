// Supabase versions of the store and auth interfaces used by handlers.mjs.
import {createClient} from '@supabase/supabase-js';

export function supabaseEnv(env=process.env){
  const url=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=env.SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
  return {url,anonKey,serviceKey,secret:env.RUN_SEED_SECRET,ready:Boolean(url&&anonKey&&serviceKey&&env.RUN_SEED_SECRET)};
}

const must=({data,error})=>{if(error)throw new Error(error.message);return data;};

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
    async startRun({playerId,game,day,seed,limit}){const rows=must(await admin.rpc('start_run',{p_player:playerId,p_game:game,p_day:day,p_seed:seed,p_limit:limit}));return run(rows?.[0])??null;},
    async getRun(id){if(!/^[0-9a-f-]{36}$/i.test(id))return null;return run(must(await admin.from('runs').select(RUN_FIELDS).eq('id',id).maybeSingle()));},
    // Compare-and-set on `segments` and `status`, so the same submission can't be counted twice.
    async updateRunIf(id,segments,patch){const rows=must(await admin.from('runs').update(patch).eq('id',id).eq('segments',segments).eq('status','open').select('id'));return rows.length?rows[0]:null;},
    async scoredRuns(from,to){
      const out=[];
      for(let page=0;;page++){
        const rows=must(await admin.from('runs').select('player_id,game,score,day,updated_at').neq('status','rejected').gt('score',0).gte('day',from).lte('day',to).order('id').range(page*1000,page*1000+999));
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
  };
  return {store,auth};
}
