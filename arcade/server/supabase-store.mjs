// Supabase versions of the store and auth interfaces used by handlers.mjs.
import {createClient} from '@supabase/supabase-js';
import {AdminLogNotReady,MonthEndNotReady,columnMissing,tableMissing} from './competition.mjs';
import {CoinsNotReady,coinsMissing} from './coins.mjs';
import {StripeNotReady,cleanStripeId} from './stripe.mjs';

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
  // The same row with what Stripe calls it. Read separately because the two columns arrive with
  // supabase/stripe.sql: a deployment without that file still reads every purchase it has, with no refs.
  const PURCHASE_STRIPE_FIELDS=`${PURCHASE_FIELDS},provider_ref,provider_payment_ref`;
  const run=r=>r&&{...r,seed:Number(r.seed)};
  const purchase=p=>p&&{...p,coins:Number(p.coins)||0,pack:Number(p.pack)||0,amount_cents:Number(p.amount_cents)||0};
  // A purchase read asks for the Stripe columns first and drops back to the columns every deployment has if
  // stripe.sql has not been run. `build` is handed the column list and returns the query, so the retry is the
  // same read with a shorter select rather than a second code path. coinsOptional still covers a deployment
  // that has not run paid-tries.sql either, where there is no purchases table at all.
  const readPurchases=async(build,fallback)=>{
    const first=await build(PURCHASE_STRIPE_FIELDS);
    if(!first.error)return first.data??fallback;
    if(!columnMissing(first.error))return coinsOptional(first,fallback);
    return coinsOptional(await build(PURCHASE_FIELDS),fallback);
  };
  const purchaseList=build=>readPurchases(build,[]);
  const onePurchase=build=>readPurchases(build,null);
  // Set once supabase/stripe.sql has been seen to have run; see stripeReady below.
  let stripeMigrated=false;

  const store={
    async inviteAvailable(code){const d=must(await admin.from('invites').select('uses,max_uses').eq('code',code).maybeSingle());return Boolean(d&&d.uses<d.max_uses);},
    async useInvite(code){return must(await admin.rpc('use_invite',{p_code:code}))===true;},
    async createPlayer(p){return must(await admin.from('players').insert(p).select().single());},
    async getPlayer(id){return must(await admin.from('players').select('id,name,bottle').eq('id',id).maybeSingle());},
    async updatePlayer(id,patch){return must(await admin.from('players').update(patch).eq('id',id).select('id,name,bottle').single());},
    async playersByIds(ids){if(!ids.length)return [];return must(await admin.from('players').select('id,name,bottle').in('id',ids));},
    // Admin only, for handing out coins by hand. The balance is 0 everywhere until the paid-tries migration runs.
    // The invite code and the signup time ride along because the admin page's duplicate check is made of
    // them. Both have been on the table since schema.sql; nothing had asked for them before.
    async allPlayers(){
      const fields='id,name,bottle,invite_code,created_at';
      const rows=coinsOptional(await admin.from('players').select(`${fields},coins`).order('name'),null);
      if(rows)return rows.map(p=>({...p,coins:Number(p.coins)||0}));
      return must(await admin.from('players').select(fields).order('name')).map(p=>({...p,coins:0}));
    },
    // Several runs at once, for the admin page's look at a month's winners. The replays come with them,
    // because re-verifying a winner's run is the point of asking.
    async runsByIds(ids){
      if(!ids.length)return [];
      const fields=(await this.flagReasonsReady())?`${RUN_FIELDS},flag_reasons`:RUN_FIELDS;
      return must(await admin.from('runs').select(fields).in('id',ids)).map(run);
    },
    // A player's earlier verified scores in one game, for the personal-best flag. Rejected runs are not
    // history, and a run that never had a segment verified never happened.
    async playerGameScores(playerId,game,excludeRunId=null){
      const out=[];
      for(let page=0;;page++){
        const rows=must(await admin.from('runs').select('id,score').eq('player_id',playerId).eq('game',game)
          .neq('status','rejected').gt('segments',0).order('id').range(page*1000,page*1000+999));
        out.push(...rows.filter(r=>r.id!==excludeRunId).map(r=>Number(r.score)||0));
        if(rows.length<1000)return out;
      }
    },
    // How many verified runs each player has per game, and their best. Folded down here rather than in the
    // handler so what crosses the wire is one row per player and game, not one per run.
    async runTotalsByPlayer(){
      const out=new Map();
      for(let page=0;;page++){
        const rows=must(await admin.from('runs').select('player_id,game,score').neq('status','rejected')
          .gt('segments',0).order('id').range(page*1000,page*1000+999));
        for(const r of rows){
          const key=`${r.player_id}|${r.game}`,row=out.get(key)??{player_id:r.player_id,game:r.game,runs:0,best:0};
          row.runs++;row.best=Math.max(row.best,Number(r.score)||0);
          out.set(key,row);
        }
        if(rows.length<1000)return [...out.values()];
      }
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
    async allMonthResults(){return optional(await admin.from('month_results').select('month,game,rank,player_id,score,winner').order('month').order('game').order('rank'),[]).map(r=>({...r,score:Number(r.score)||0}));},
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
      return purchase(await onePurchase(select=>admin.from('purchases').select(select).eq('id',id).maybeSingle()));
    },
    async playerPurchases(playerId,statuses=null){
      return (await purchaseList(select=>{
        let query=admin.from('purchases').select(select).eq('player_id',playerId);
        if(statuses)query=query.in('status',statuses);
        return query.order('created_at');
      })).map(purchase);
    },
    async purchasesByStatus(statuses){
      return (await purchaseList(select=>admin.from('purchases').select(select).in('status',statuses).order('created_at'))).map(purchase);
    },
    // One purchase by what Stripe calls it: the Checkout Session id, or the payment intent a refund or a
    // dispute arrives under. Both are unique, so this is one row or none.
    async purchaseByProviderRef(ref){
      const id=cleanStripeId(ref);
      if(!id)return null;
      const {data,error}=await admin.from('purchases').select(PURCHASE_STRIPE_FIELDS)
        .or(`provider_ref.eq.${id},provider_payment_ref.eq.${id}`).limit(1).maybeSingle();
      if(error){
        if(coinsMissing(error)||columnMissing(error))return null;
        throw new Error(error.message);
      }
      return purchase(data??null);
    },
    // What Stripe calls this purchase, written down the first time an event names it so a later refund can be
    // traced back. Neither ref is ever overwritten with nothing.
    async setPurchaseRefs(id,{sessionId=null,paymentRef=null}={}){
      const patch={};
      if(cleanStripeId(sessionId))patch.provider_ref=cleanStripeId(sessionId);
      if(cleanStripeId(paymentRef))patch.provider_payment_ref=cleanStripeId(paymentRef);
      if(!Object.keys(patch).length)return null;
      const {data,error}=await admin.from('purchases').update(patch).eq('id',id).select('id,provider_ref,provider_payment_ref').maybeSingle();
      if(error){
        if(columnMissing(error)||coinsMissing(error))throw new StripeNotReady();
        throw new Error(error.message);
      }
      return data??null;
    },
    // Whether supabase/stripe.sql has run: the two columns on purchases and the event log. Until it has, the
    // shop stays hidden on a Stripe deployment and the webhook answers 503 rather than granting unrecorded.
    //
    // A yes is remembered, because /api/me asks on every read and a migration is never un-run. A no is asked
    // again every time, so running the file takes effect without a redeploy.
    async stripeReady(){
      if(stripeMigrated)return true;
      for(const [table,column] of [['purchases','provider_ref'],['payment_events','type']]){
        const {error}=await admin.from(table).select(column,{head:true,count:'exact'});
        if(error){if(coinsMissing(error)||columnMissing(error))return false;throw new Error(error.message);}
      }
      stripeMigrated=true;
      return true;
    },
    // Every webhook event that has already been acted on, by Stripe's own event id. The primary key is what
    // makes a replay a no-op even if two deliveries arrive at the same moment.
    async paymentEventSeen(id){
      const {data,error}=await admin.from('payment_events').select('id').eq('id',String(id)).maybeSingle();
      if(error){
        if(coinsMissing(error))throw new StripeNotReady();
        throw new Error(error.message);
      }
      return Boolean(data);
    },
    async recordPaymentEvent({id,provider='stripe',type,purchaseId=null}){
      const {error}=await admin.from('payment_events').insert({id:String(id),provider,type,purchase_id:purchaseId});
      // A duplicate means another delivery of the same event got there first, which is the whole point.
      if(error&&error.code!=='23505'){
        if(coinsMissing(error))throw new StripeNotReady();
        throw new Error(error.message);
      }
      return {id:String(id)};
    },
    // The four things that move coins are one database function each, so each is one transaction and each is
    // safe to call twice. See supabase/paid-tries.sql.
    async grantPurchase(id,adminEmail){return needsCoins(await admin.rpc('grant_purchase',{p_purchase:id,p_admin:adminEmail??null}))??{found:false};},
    async cancelPurchase(id,adminEmail){return needsCoins(await admin.rpc('cancel_purchase',{p_purchase:id,p_admin:adminEmail??null}))??{found:false};},
    async adjustCoins(playerId,delta,note,adminEmail){return needsCoins(await admin.rpc('adjust_coins',{p_player:playerId,p_delta:delta,p_note:note,p_admin:adminEmail??null}))??{found:false};},
    async refundPurchase(id,adminEmail){return needsCoins(await admin.rpc('refund_purchase',{p_purchase:id,p_admin:adminEmail??null}))??{found:false};},
    // Achievements. See the note in memory-store.mjs: one row per verified, committed run, deleted with the
    // run if a refund takes it off the boards. Reads fall back to empty until achievements.sql has run, so
    // the shelf shows as unearned rather than the page failing.
    async achievementsReady(){
      const {error}=await admin.from('run_achievements').select('run_id',{head:true,count:'exact'});
      if(error){if(tableMissing(error))return false;throw new Error(error.message);}
      return true;
    },
    async runStatsFor(runId){
      if(!/^[0-9a-f-]{36}$/i.test(runId))return null;
      return optional(await admin.from('run_achievements').select('run_id,player_id,game,stats').eq('run_id',runId).maybeSingle(),null);
    },
    async saveRunStats({runId,playerId,game,stats}){
      const row={run_id:runId,player_id:playerId,game,stats};
      return optional(await admin.from('run_achievements').upsert(row,{onConflict:'run_id'}).select('run_id').maybeSingle(),null);
    },
    async playerRunStats(playerId){
      const out=[];
      for(let page=0;;page++){
        const rows=optional(await admin.from('run_achievements').select('game,stats').eq('player_id',playerId).order('run_id').range(page*1000,page*1000+999),null);
        if(!rows)return out;
        out.push(...rows);if(rows.length<1000)return out;
      }
    },
    async coinLedger({playerId=null,limit=50}={}){
      let query=admin.from('coin_ledger').select('id,player_id,delta,reason,purchase_id,run_id,admin_email,note,created_at');
      if(playerId)query=query.eq('player_id',playerId);
      return coinsOptional(await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit),[])
        .map(r=>({...r,delta:Number(r.delta)||0}));
    },

    // Reviewing runs and handing out invite codes. Only the writes need admin-log.sql: the two lists below
    // read tables that have always been there, so the admin page still shows everything without it.
    async adminLogReady(){
      const {error}=await admin.from('admin_log').select('id',{head:true,count:'exact'});
      if(error){if(tableMissing(error))return false;throw new Error(error.message);}
      return true;
    },
    // Whether flag-details.sql has run. Without it the two columns are simply not written or read, and the
    // admin page falls back to the fixed sentence it showed before.
    async flagDetailsReady(){
      const {error}=await admin.from('runs').select('claimed_score',{head:true,count:'exact'});
      if(error){if(columnMissing(error))return false;throw new Error(error.message);}
      return true;
    },
    // Whether flag-reasons.sql has run. Without it the column is neither written nor read, and the admin
    // page falls back to the one sentence it showed when there was one way to be flagged.
    async flagReasonsReady(){
      const {error}=await admin.from('runs').select('flag_reasons',{head:true,count:'exact'});
      if(error){if(columnMissing(error))return false;throw new Error(error.message);}
      return true;
    },
    async runsToReview({from,to,game=null,state=null}){
      // Each column can only be selected once its own migration has run.
      let fields=(await this.flagDetailsReady())?`${RUN_FIELDS},claimed_score,verified_score`:RUN_FIELDS;
      if(await this.flagReasonsReady())fields=`${fields},flag_reasons`;
      let query=admin.from('runs').select(fields).gte('day',from).lte('day',to);
      if(game)query=query.eq('game',game);
      // Flagged or rejected, which PostgREST cannot express as two filters, so it goes as one or().
      if(state==='rejected')query=query.eq('status','rejected');
      else if(state==='flagged')query=query.eq('flagged',true).neq('status','rejected');
      else query=query.or('flagged.eq.true,status.eq.rejected');
      return must(await query.order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(200)).map(run);
    },
    // Both actions are a conditional update, so a second click changes nothing and writes no second log row.
    async reviewRun(id,{action,note='',adminEmail=null,afterFinalise=false}){
      if(!/^[0-9a-f-]{36}$/i.test(String(id)))return {found:false};
      const current=run(must(await admin.from('runs').select(RUN_FIELDS).eq('id',id).maybeSingle()));
      if(!current)return {found:false};
      const at=new Date().toISOString(),was={game:current.game,day:current.day,score:current.score};
      const write=async(patch,match)=>run(must(await admin.from('runs').update(patch).eq('id',id).match(match).select(RUN_FIELDS).maybeSingle()));
      if(action==='reject'){
        if(current.status==='rejected')return {found:true,changed:false,run:current};
        const updated=await write({status:'rejected',reject_reason:note,flagged:false,updated_at:at,
          finished_at:current.finished_at??at},{status:current.status});
        if(!updated)return {found:true,changed:false,run:current};
        await writeAdminLog({action:'run_reject',run_id:id,note,details:{...was,after_finalise:Boolean(afterFinalise)},admin_email:adminEmail});
        return {found:true,changed:true,run:updated};
      }
      if(!current.flagged)return {found:true,changed:false,run:current};
      const updated=await write({flagged:false,updated_at:at},{flagged:true});
      if(!updated)return {found:true,changed:false,run:current};
      await writeAdminLog({action:'run_clear_flag',run_id:id,note,details:was,admin_email:adminEmail});
      return {found:true,changed:true,run:updated};
    },
    async listInvites(){
      return must(await admin.from('invites').select('code,uses,max_uses,note,created_at').order('code'))
        .map(r=>({...r,uses:Number(r.uses)||0,max_uses:Number(r.max_uses)||0,note:r.note??''}));
    },
    // A code that is already there is left exactly as it is: the insert is ignored rather than overwriting
    // somebody else's note or widening a code that is already out there.
    async createInvite({code,maxUses,note='',adminEmail=null}){
      const existing=must(await admin.from('invites').select('code,uses,max_uses').eq('code',code).maybeSingle());
      if(existing)return {created:false,code,max_uses:Number(existing.max_uses)||0,uses:Number(existing.uses)||0};
      const row=must(await admin.from('invites').insert({code,max_uses:maxUses,note}).select('code,uses,max_uses').single());
      await writeAdminLog({action:'invite_create',invite_code:code,note,details:{max_uses:maxUses},admin_email:adminEmail});
      return {created:true,code,max_uses:Number(row.max_uses)||0,uses:Number(row.uses)||0};
    },
    async setInviteMaxUses(code,maxUses,adminEmail=null){
      const existing=must(await admin.from('invites').select('code,uses,max_uses').eq('code',code).maybeSingle());
      if(!existing)return {found:false};
      const before=Number(existing.max_uses)||0;
      if(before===maxUses)return {found:true,changed:false,code,max_uses:before,uses:Number(existing.uses)||0};
      const row=must(await admin.from('invites').update({max_uses:maxUses}).eq('code',code).eq('max_uses',before)
        .select('code,uses,max_uses').maybeSingle());
      if(!row)return {found:true,changed:false,code,max_uses:before,uses:Number(existing.uses)||0};
      await writeAdminLog({action:'invite_max_uses',invite_code:code,note:`${before} to ${maxUses}`,
        details:{from:before,to:maxUses},admin_email:adminEmail});
      return {found:true,changed:true,code,max_uses:Number(row.max_uses)||0,uses:Number(row.uses)||0};
    },
    async adminActions({limit=30}={}){
      return optional(await admin.from('admin_log').select('id,admin_email,action,run_id,invite_code,note,details,created_at')
        .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit),[]);
    },
  };

  // The one write that needs admin-log.sql. It runs after the change it describes, so a missing table is
  // reported as AdminLogNotReady and the handler refuses the action before ever getting here.
  async function writeAdminLog(row){
    const {error}=await admin.from('admin_log').insert(row);
    if(error){if(tableMissing(error))throw new AdminLogNotReady();throw new Error(error.message);}
  }

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
    //
    // This used to be one getUserById per id, in sequence, which the admin page already called with every
    // player it knew about — fifty players meant fifty round trips inside one Vercel function, and the
    // duplicate-accounts panel wants every address there is. listUsers hands back a page of a thousand in
    // one call, so the whole directory is one request (two or three for a club that ever gets that big),
    // and the ids asked for are picked out of it.
    //
    // It falls back to the old way if listUsers is refused, so a key without that permission still gets
    // the addresses it needs for a podium of three.
    async emailsByIds(ids){
      const wanted=new Set(ids);
      if(!wanted.size)return [];
      const all=await this.allEmails();
      if(all)return all.filter(row=>wanted.has(row.id));
      const out=[];
      for(const id of ids){const {data,error}=await admin.auth.admin.getUserById(id);if(!error&&data?.user?.email)out.push({id,email:data.user.email});}
      return out;
    },
    // Every address on the project, or null if the directory cannot be listed. Paged, so a club bigger than
    // one page still comes back whole.
    async allEmails(){
      const out=[];
      for(let page=1;page<=20;page++){
        const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
        if(error)return null;
        const users=data?.users??[];
        for(const user of users)if(user?.id&&user?.email)out.push({id:user.id,email:user.email});
        if(users.length<1000)return out;
      }
      return out;
    },
  };
  return {store,auth};
}
