// Supabase versions of the store and auth interfaces used by handlers.mjs.
import {createClient} from '@supabase/supabase-js';
import {MonthEndNotReady,tableMissing} from './competition.mjs';
import {CoinsNotReady,coinsMissing} from './coins.mjs';

export function supabaseEnv(env=process.env){
  const url=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=env.SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
  // Whoever runs the competition, and so can see and finalise monthly results and resolve purchases.
  const admins=String(env.ARCADE_ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean);
  return {url,anonKey,serviceKey,secret:env.RUN_SEED_SECRET,admins,ready:Boolean(url&&anonKey&&serviceKey&&env.RUN_SEED_SECRET)};
}

const must=({data,error})=>{if(error)throw new Error(error.message);return data;};
// For the month-end tables only: a read falls back when the migration has not run, a write says so.
const optional=({data,error},fallback)=>{if(!error)return data??fallback;if(tableMissing(error))return fallback;throw new Error(error.message);};
const needsTable=({data,error})=>{if(!error)return data;if(tableMissing(error))throw new MonthEndNotReady();throw new Error(error.message);};
// The same two shapes for the paid-tries tables, columns and functions.
const coinsOptional=({data,error},fallback)=>{if(!error)return data??fallback;if(coinsMissing(error))return fallback;throw new Error(error.message);};
const needsCoins=({data,error})=>{if(!error)return data;if(coinsMissing(error))throw new CoinsNotReady();throw new Error(error.message);};

export function createSupabaseBackend(env=supabaseEnv()){
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(env.url,env.serviceKey,options),pub=createClient(env.url,env.anonKey,options);
  const RUN_FIELDS='id,player_id,game,day,seed,level,segments,score,status,flagged,reject_reason,replays,started_at,updated_at,finished_at';
  const PURCHASE_FIELDS='id,player_id,pack,coins,amount_cents,currency,reference,provider,status,created_at,resolved_at,resolved_by';
  const run=r=>r&&{...r,seed:Number(r.seed)};
  const purchase=p=>p&&{...p,coins:Number(p.coins)||0,pack:Number(p.pack)||0,amount_cents:Number(p.amount_cents)||0};

  const store={
    async inviteAvailable(code){const d=must(await admin.from('invites').select('uses,max_uses').eq('code',code).maybeSingle());return Boolean(d&&d.uses<d.max_uses);},
    async useInvite(code){return must(await admin.rpc('use_invite',{p_code:code}))===true;},
    async createPlayer(p){return must(await admin.from('players').insert(p).select().single());},
    async getPlayer(id){return must(await admin.from('players').select('id,name,bottle').eq('id',id).maybeSingle());},
    async updatePlayer(id,patch){return must(await admin.from('players').update(patch).eq('id',id).select('id,name,bottle').single());},
    async playersByIds(ids){if(!ids.length)return [];return must(await admin.from('players').select('id,name,bottle').in('id',ids));},
    // Admin only, for handing out coins by hand. The balance is 0 everywhere until the paid-tries migration runs.
    async allPlayers(){
      const rows=coinsOptional(await admin.from('players').select('id,name,bottle,coins').order('name'),null);
      if(rows)return rows.map(p=>({...p,coins:Number(p.coins)||0}));
      return must(await admin.from('players').select('id,name,bottle').order('name')).map(p=>({...p,coins:0}));
    },
    // Today's free tries only: a paid run must not use one of the three free tries up. Before the migration
    // there is no `paid` column and every run is a free one.
    async countRuns(playerId,day){
      let result=await admin.from('runs').select('game,paid').eq('player_id',playerId).eq('day',day);
      if(result.error&&coinsMissing(result.error))result=await admin.from('runs').select('game').eq('player_id',playerId).eq('day',day);
      const out={};
      for(const r of must(result))if(r.paid!==true)out[r.game]=(out[r.game]||0)+1;
      return out;
    },
    // start_run counts and inserts in one locked step. The seven-argument version also spends a coin when the
    // free tries are gone; on a deployment without the paid-tries migration it is not there, and the
    // six-argument version (free tries only) answers instead.
    async startRun({playerId,game,day,seed,limit,requestId=null,allowPaid=false}){
      const args={p_player:playerId,p_game:game,p_day:day,p_seed:seed,p_limit:limit};
      if(allowPaid){
        const result=await admin.rpc('start_run',{...args,p_request:requestId,p_allow_paid:true});
        if(!result.error)return run(result.data?.[0])??null;
        if(!coinsMissing(result.error))throw new Error(result.error.message);
      }
      const rows=must(await admin.rpc('start_run',{...args,...(requestId?{p_request:requestId}:{})}));
      return run(rows?.[0])??null;
    },
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

    // Paid extra tries. Whether the paid-tries migration has run: both tables and the balance column. Without
    // it the shop stays hidden, nobody has coins and everything else carries on.
    async coinsReady(){
      for(const [table,column] of [['purchases','reference'],['coin_ledger','delta'],['players','coins']]){
        const {error}=await admin.from(table).select(column,{head:true,count:'exact'});
        if(error){if(coinsMissing(error))return false;throw new Error(error.message);}
      }
      return true;
    },
    async coinsFor(playerId){
      const row=coinsOptional(await admin.from('players').select('coins').eq('id',playerId).maybeSingle(),null);
      return Math.max(0,Number(row?.coins)||0);
    },
    async createPurchase({playerId,pack,coins,amountCents,currency,reference,provider}){
      return purchase(needsCoins(await admin.from('purchases')
        .insert({player_id:playerId,pack,coins,amount_cents:amountCents,currency,reference,provider})
        .select(PURCHASE_FIELDS).single()));
    },
    async purchaseById(id){
      if(!/^[0-9a-f-]{36}$/i.test(String(id)))return null;
      return purchase(coinsOptional(await admin.from('purchases').select(PURCHASE_FIELDS).eq('id',id).maybeSingle(),null));
    },
    async playerPurchases(playerId,statuses=null){
      let query=admin.from('purchases').select(PURCHASE_FIELDS).eq('player_id',playerId);
      if(statuses)query=query.in('status',statuses);
      return coinsOptional(await query.order('created_at'),[]).map(purchase);
    },
    async purchasesByStatus(statuses){
      return coinsOptional(await admin.from('purchases').select(PURCHASE_FIELDS).in('status',statuses).order('created_at'),[]).map(purchase);
    },
    // The four things that move coins are one database function each, so each is one transaction and each is
    // safe to call twice. See supabase/paid-tries.sql.
    async grantPurchase(id,adminEmail){return needsCoins(await admin.rpc('grant_purchase',{p_purchase:id,p_admin:adminEmail??null}))??{found:false};},
    async cancelPurchase(id,adminEmail){return needsCoins(await admin.rpc('cancel_purchase',{p_purchase:id,p_admin:adminEmail??null}))??{found:false};},
    async adjustCoins(playerId,delta,note,adminEmail){return needsCoins(await admin.rpc('adjust_coins',{p_player:playerId,p_delta:delta,p_note:note,p_admin:adminEmail??null}))??{found:false};},
    async refundPurchase(id,adminEmail){return needsCoins(await admin.rpc('refund_purchase',{p_purchase:id,p_admin:adminEmail??null}))??{found:false};},
    async coinLedger({playerId=null,limit=50}={}){
      let query=admin.from('coin_ledger').select('id,player_id,delta,reason,purchase_id,run_id,admin_email,note,created_at');
      if(playerId)query=query.eq('player_id',playerId);
      return coinsOptional(await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit),[])
        .map(r=>({...r,delta:Number(r.delta)||0}));
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
