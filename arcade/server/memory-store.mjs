// In-memory stand-ins for Supabase, used by the tests and the local preview server. Same calls as supabase-store.mjs.
import {randomUUID} from 'node:crypto';
import {refundPlan,refundedRunReason} from './coins.mjs';

export function createMemoryStore({invites={},now=()=>new Date(),flagReasons=true,stripe=true}={}){
  const codes=new Map(Object.entries(invites).map(([code,max])=>[code,{max,uses:0,note:'',created_at:null}]));
  const players=new Map(),runs=new Map(),runStats=new Map(),results=new Map(),prizes=new Map(),purchases=new Map(),ledger=[],adminEntries=[];
  // Every webhook event already acted on, by its own id, the way payment_events keeps them.
  const paymentEvents=new Map();
  const copy=v=>v&&structuredClone(v);
  // The ledger is walked in order, so each row needs a stamp and a tie-break that keep insertion order.
  let ledgerSeq=0;
  const log=row=>{const entry={id:`ledger-${String(++ledgerSeq).padStart(6,'0')}`,purchase_id:null,run_id:null,admin_email:null,note:'',created_at:now().toISOString(),...row};ledger.push(entry);return copy(entry);};
  const balance=id=>Math.max(0,Number(players.get(id)?.coins)||0);
  // Everything an admin does to a run or an invite code, in order, the way admin-log.sql keeps it.
  let adminSeq=0;
  const writeAdmin=row=>{
    const entry={id:`admin-${String(++adminSeq).padStart(6,'0')}`,run_id:null,invite_code:null,note:'',details:{},
      admin_email:null,created_at:now().toISOString(),...row};
    adminEntries.push(entry);return copy(entry);
  };
  return {
    codes,players,runs,results,prizes,purchases,ledger,adminEntries,paymentEvents,
    async inviteAvailable(code){const c=codes.get(code);return Boolean(c&&c.uses<c.max);},
    async useInvite(code){const c=codes.get(code);if(!c||c.uses>=c.max)return false;c.uses++;return true;},
    async createPlayer(p){players.set(p.id,{coins:0,...p,created_at:now().toISOString()});return copy(players.get(p.id));},
    async getPlayer(id){return copy(players.get(id))??null;},
    async updatePlayer(id,patch){Object.assign(players.get(id),patch);return copy(players.get(id));},
    async playersByIds(ids){return ids.map(id=>players.get(id)).filter(Boolean).map(copy);},
    async allPlayers(){return [...players.values()].map(copy);},
    // Several runs at once, for the admin page's look at a month's winners.
    async runsByIds(ids){return ids.map(id=>runs.get(id)).filter(Boolean).map(copy);},
    // A player's earlier verified scores in one game, for the personal-best flag. Rejected runs are not
    // history, and a run that never had a segment verified never happened.
    async playerGameScores(playerId,game,excludeRunId=null){
      return [...runs.values()]
        .filter(r=>r.player_id===playerId&&r.game===game&&r.status!=='rejected'&&r.segments>0&&r.id!==excludeRunId)
        .map(r=>Number(r.score)||0);
    },
    // How many verified runs each player has per game, and their best. One row per player and game.
    async runTotalsByPlayer(){
      const out=new Map();
      for(const r of runs.values()){
        if(r.status==='rejected'||!(r.segments>0))continue;
        const key=`${r.player_id}|${r.game}`,row=out.get(key)??{player_id:r.player_id,game:r.game,runs:0,best:0};
        row.runs++;row.best=Math.max(row.best,Number(r.score)||0);
        out.set(key,row);
      }
      return [...out.values()];
    },
    // Free tries only: a paid run never uses one of the three free tries up.
    async countRuns(playerId,day){const out={};for(const r of runs.values())if(r.player_id===playerId&&r.day===day&&!r.paid)out[r.game]=(out[r.game]||0)+1;return out;},
    async startRun({playerId,game,day,seed,limit,requestId=null,allowPaid=false}){
      if(requestId){const existing=[...runs.values()].find(r=>r.player_id===playerId&&r.request_id===requestId);if(existing)return copy(existing);}
      const used=[...runs.values()].filter(r=>r.player_id===playerId&&r.game===game&&r.day===day&&!r.paid).length;
      let paid=false;
      if(used>=limit){
        if(!allowPaid||balance(playerId)<1)return null;
        paid=true;
      }
      const t=now().toISOString();
      for(const r of runs.values())if(r.player_id===playerId&&r.game===game&&r.status==='open'){r.status='closed';r.finished_at=t;}
      const run={request_id:requestId,id:randomUUID(),player_id:playerId,game,day,seed,level:1,segments:0,score:0,status:'open',flagged:false,paid,replays:[],started_at:t,updated_at:t,finished_at:null,reject_reason:null,
        claimed_score:null,verified_score:null,flag_reasons:[]};
      runs.set(run.id,run);
      // The coin and the run are one step here, as they are in one transaction in start_run.
      if(paid){players.get(playerId).coins=balance(playerId)-1;log({player_id:playerId,delta:-1,reason:'run',run_id:run.id,note:`Extra try: ${game}`});}
      return copy(run);
    },
    async getRun(id){return copy(runs.get(id))??null;},
    async updateRunIf(id,segments,patch){const r=runs.get(id);if(!r||r.segments!==segments||r.status!=='open')return null;Object.assign(r,patch);return copy(r);},
    async finishedScores(playerId){return [...runs.values()].filter(r=>r.player_id===playerId&&r.status==='closed').map(r=>r.score);},
    async scoredRuns(from,to){return [...runs.values()].filter(r=>r.status!=='rejected'&&r.score>0&&r.day>=from&&r.day<=to).map(({id,player_id,game,score,day,updated_at})=>({id,player_id,game,score,day,updated_at}));},
    // Finished months, archived once an admin finalises them.
    async monthResults(month){return (results.get(month)??[]).map(copy);},
    async saveMonthResults(month,rows){results.set(month,rows.map(r=>({...r,month,finalised_at:now().toISOString()})));return (results.get(month)??[]).map(copy);},
    async allMonthResults(){return [...results.values()].flat().map(copy);},
    async finalisedMonths(){return [...results.keys()].filter(m=>results.get(m)?.length).sort();},
    async prizes(){return Object.fromEntries(prizes);},
    async setPrize(game,text){prizes.set(game,text);return text;},
    async monthEndReady(){return true;},

    // Paid extra tries. Everything that moves coins is one call here, as it is one function in Postgres.
    async coinsReady(){return true;},
    async coinsFor(playerId){return balance(playerId);},
    async createPurchase({playerId,pack,coins,amountCents,currency,reference,provider}){
      if([...purchases.values()].some(p=>p.reference===reference))throw Object.assign(new Error('duplicate key value violates unique constraint "purchases_reference_key"'),{code:'23505'});
      const row={id:randomUUID(),player_id:playerId,pack,coins,amount_cents:amountCents,currency,reference,provider,status:'pending',created_at:now().toISOString(),resolved_at:null,resolved_by:null,
        provider_ref:null,provider_payment_ref:null};
      purchases.set(row.id,row);return copy(row);
    },
    async purchaseById(id){return copy(purchases.get(id))??null;},
    async playerPurchases(playerId,statuses=null){
      return [...purchases.values()].filter(p=>p.player_id===playerId&&(!statuses||statuses.includes(p.status)))
        .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(copy);
    },
    async purchasesByStatus(statuses){
      return [...purchases.values()].filter(p=>statuses.includes(p.status))
        .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(copy);
    },
    // Card payments: what Stripe calls a purchase, and the events already acted on. stripe.sql adds the two
    // columns and the one table in production; here they are always there unless a test says otherwise.
    async stripeReady(){return stripe;},
    async purchaseByProviderRef(ref){
      if(!ref)return null;
      return copy([...purchases.values()].find(p=>p.provider_ref===ref||p.provider_payment_ref===ref))??null;
    },
    async setPurchaseRefs(id,{sessionId=null,paymentRef=null}={}){
      const p=purchases.get(id);
      if(!p)return null;
      if(sessionId)p.provider_ref=sessionId;
      if(paymentRef)p.provider_payment_ref=paymentRef;
      return {id:p.id,provider_ref:p.provider_ref,provider_payment_ref:p.provider_payment_ref};
    },
    async paymentEventSeen(id){return paymentEvents.has(String(id));},
    async recordPaymentEvent({id,provider='stripe',type,purchaseId=null}){
      const key=String(id);
      if(!paymentEvents.has(key))paymentEvents.set(key,{id:key,provider,type,purchase_id:purchaseId,created_at:now().toISOString()});
      return copy(paymentEvents.get(key));
    },
    async grantPurchase(id,adminEmail){
      const p=purchases.get(id);
      if(!p)return {found:false};
      if(p.status==='pending'){
        p.status='paid';p.resolved_at=now().toISOString();p.resolved_by=adminEmail??p.resolved_by;
        log({player_id:p.player_id,delta:p.coins,reason:'purchase',purchase_id:p.id,admin_email:adminEmail??null,note:`Paid ${p.reference}`});
        players.get(p.player_id).coins=balance(p.player_id)+p.coins;
        return {found:true,granted:true,status:p.status,reference:p.reference,coins:p.coins,balance:balance(p.player_id)};
      }
      return {found:true,granted:false,status:p.status,reference:p.reference,coins:p.coins,balance:balance(p.player_id)};
    },
    async cancelPurchase(id,adminEmail){
      const p=purchases.get(id);
      if(!p)return {found:false};
      if(p.status!=='pending')return {found:true,cancelled:false,status:p.status,reference:p.reference};
      p.status='cancelled';p.resolved_at=now().toISOString();p.resolved_by=adminEmail??null;
      log({player_id:p.player_id,delta:0,reason:'admin',purchase_id:p.id,admin_email:adminEmail??null,note:`Cancelled ${p.reference}`});
      return {found:true,cancelled:true,status:p.status,reference:p.reference};
    },
    async adjustCoins(playerId,delta,note,adminEmail){
      if(!players.has(playerId))return {found:false};
      const before=balance(playerId),after=Math.max(0,before+delta);
      players.get(playerId).coins=after;
      log({player_id:playerId,delta:after-before,reason:'admin',admin_email:adminEmail??null,note:after===before?`${note} (no change)`:note});
      return {found:true,balance:after,delta:after-before};
    },
    async refundPurchase(id,adminEmail){
      const p=purchases.get(id);
      if(!p)return {found:false};
      if(p.status!=='paid')return {found:true,refunded:false,status:p.status,balance:balance(p.player_id)};
      const plan=refundPlan(ledger,p),take=Math.min(plan.unspent,balance(p.player_id)),t=now().toISOString();
      players.get(p.player_id).coins=balance(p.player_id)-take;
      for(const runId of plan.runs){
        const run=runs.get(runId);
        if(run&&run.status!=='rejected')Object.assign(run,{status:'rejected',reject_reason:refundedRunReason(p.reference),updated_at:t,finished_at:run.finished_at??t});
        // A refunded run is off the boards, so whatever it earned goes with it. In production the trigger in
        // achievements.sql does this, on any path that rejects a run; here it is the same rule by hand.
        runStats.delete(runId);
      }
      p.status='refunded';p.resolved_at=t;p.resolved_by=adminEmail??null;
      log({player_id:p.player_id,delta:-take,reason:'refund',purchase_id:p.id,admin_email:adminEmail??null,
        note:`Refunded ${p.reference}: ${take} unspent coin(s) taken back, ${plan.runs.length} paid run(s) dropped from the boards`});
      return {found:true,refunded:true,removed:take,unspent:plan.unspent,runs:plan.runs.length,balance:balance(p.player_id)};
    },
    // Achievements. One row per run that has been verified and committed, holding only what that run's own
    // replay produced. A run rejected at verification never gets a row; a run rejected later by a refund has
    // its row taken away with it, which is what makes "refunded runs never count" true in both directions.
    async achievementsReady(){return true;},
    async runStatsFor(runId){return copy(runStats.get(runId))??null;},
    async saveRunStats({runId,playerId,game,stats}){
      runStats.set(runId,{run_id:runId,player_id:playerId,game,stats:{...stats},created_at:now().toISOString()});
      return copy(runStats.get(runId));
    },
    async playerRunStats(playerId){
      return [...runStats.values()].filter(r=>r.player_id===playerId).map(copy);
    },
    async coinLedger({playerId=null,limit=50}={}){
      return ledger.filter(r=>!playerId||r.player_id===playerId).slice(-limit).reverse().map(copy);
    },

    // Reviewing runs and handing out invite codes. admin-log.sql adds the one table the actions below write
    // to; until it has run, adminLogReady() is false and every action is refused rather than made untraceably.
    async adminLogReady(){return true;},
    async flagDetailsReady(){return true;},
    // Whether flag-reasons.sql has run. The tests set this false to exercise the fallback, which is the
    // single sentence the admin page showed when there was only one way to be flagged.
    async flagReasonsReady(){return flagReasons;},
    // Everything worth a second look in one month: the runs a verification flagged, and the ones already
    // rejected, newest change first.
    async runsToReview({from,to,game=null,state=null}){
      return [...runs.values()]
        .filter(r=>r.day>=from&&r.day<=to&&(r.flagged||r.status==='rejected'))
        .filter(r=>!game||r.game===game)
        .filter(r=>state==='flagged'?r.status!=='rejected':state==='rejected'?r.status==='rejected':true)
        .sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))||String(b.id).localeCompare(String(a.id)))
        .map(copy);
    },
    // Clearing a flag leaves the run counting; rejecting it stops it counting anywhere. Both say whether they
    // actually changed anything, so clicking twice is harmless and only the first click is logged.
    async reviewRun(id,{action,note='',adminEmail=null,afterFinalise=false}){
      const run=runs.get(id);
      if(!run)return {found:false};
      const t=now().toISOString(),was={game:run.game,day:run.day,score:run.score};
      if(action==='reject'){
        if(run.status==='rejected')return {found:true,changed:false,run:copy(run)};
        Object.assign(run,{status:'rejected',reject_reason:note,flagged:false,updated_at:t,finished_at:run.finished_at??t});
        writeAdmin({action:'run_reject',run_id:run.id,note,details:{...was,after_finalise:Boolean(afterFinalise)},admin_email:adminEmail});
        return {found:true,changed:true,run:copy(run)};
      }
      if(!run.flagged)return {found:true,changed:false,run:copy(run)};
      Object.assign(run,{flagged:false,updated_at:t});
      writeAdmin({action:'run_clear_flag',run_id:run.id,note,details:was,admin_email:adminEmail});
      return {found:true,changed:true,run:copy(run)};
    },
    async listInvites(){
      return [...codes.entries()].map(([code,c])=>({code,uses:c.uses,max_uses:c.max,note:c.note??'',created_at:c.created_at}))
        .sort((a,b)=>a.code.localeCompare(b.code));
    },
    // A code that is already there is left exactly as it is, so a second click cannot widen or reword it.
    async createInvite({code,maxUses,note='',adminEmail=null}){
      if(codes.has(code))return {created:false,code,max_uses:codes.get(code).max,uses:codes.get(code).uses};
      codes.set(code,{max:maxUses,uses:0,note,created_at:now().toISOString()});
      writeAdmin({action:'invite_create',invite_code:code,note,details:{max_uses:maxUses},admin_email:adminEmail});
      return {created:true,code,max_uses:maxUses,uses:0};
    },
    async setInviteMaxUses(code,maxUses,adminEmail=null){
      const c=codes.get(code);
      if(!c)return {found:false};
      if(c.max===maxUses)return {found:true,changed:false,code,max_uses:c.max,uses:c.uses};
      const before=c.max;c.max=maxUses;
      writeAdmin({action:'invite_max_uses',invite_code:code,note:`${before} to ${maxUses}`,
        details:{from:before,to:maxUses},admin_email:adminEmail});
      return {found:true,changed:true,code,max_uses:maxUses,uses:c.uses};
    },
    async adminActions({limit=30}={}){return adminEntries.slice(-limit).reverse().map(copy);},
  };
}

export function createMemoryAuth(){
  const users=new Map(),tokens=new Map(),sent=[];
  return {
    users,sent,
    tokenFor(email){const u=[...users.values()].find(u=>u.email===email);if(!u)return null;const t=`token-${u.id}`;tokens.set(t,u);return t;},
    async userFromToken(token){return tokens.get(token)??null;},
    async createUser(email){const existing=[...users.values()].find(u=>u.email===email);if(existing)return {exists:true,id:existing.id};const u={id:randomUUID(),email};users.set(u.id,u);return {id:u.id};},
    async deleteUser(id){users.delete(id);},
    async sendLink(email,redirectTo){sent.push({email,redirectTo});},
    async emailsByIds(ids){return ids.map(id=>users.get(id)).filter(Boolean).map(u=>({id:u.id,email:u.email}));},
    // The whole directory in one call, the way listUsers answers in production.
    async allEmails(){return [...users.values()].map(u=>({id:u.id,email:u.email}));},
  };
}
