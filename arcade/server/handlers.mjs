import {isDeepStrictEqual} from 'node:util';
// The competition API, written against two small interfaces so it can be tested without a network:
//   auth:  userFromToken(token), createUser(email), sendLink(email, redirectTo)
//   store: see supabase-store.mjs (memory-store.mjs in the tests implements the same calls)
import {COMPETITION,dayKey,monthKey,yearKey,monthRange,yearRange,seedFor,cleanName,cleanEmail,cleanCode,cleanMonth,cleanPrize,monthlyStandings,yearlyStandings,gameStandings,podiumMonths,previousMonth,monthPodium,monthResults} from './competition.mjs';
import {AdminLogNotReady,MonthEndNotReady} from './competition.mjs';
import {prizeLine,gameLabel,monthLabel} from '../ui/month-prizes.js';
import {BOTTLE_SKINS,pointsForGame,bottleUnlocked} from '../ui/bottle-unlocks.js';
import {verifySegment,RejectedRun} from './verify.mjs';
import {runFlags,mergeReasons,formatDuration,summariseReplays,LEGACY_FLAG_REASON} from './flags.mjs';
import {duplicateGroups,totalsIndex} from './duplicates.mjs';
import {BLOCKS_REPLAY_VERSION} from '../../dist/blocks-core.js';
import {addRun,totalsFrom,achievementState,newlyEarned} from '../../dist/achievements.js';
import {COIN_CURRENCY,CoinsNotReady,MAX_PENDING_PURCHASES,cleanDelta,cleanNote,cleanPackCoins,formatAmount,newReference,packFor,packList} from './coins.mjs';
import {createPaymentProvider} from './payments.mjs';
import {StripeError,StripeNotReady} from './stripe.mjs';

export const BOTTLES=BOTTLE_SKINS.map(b=>b.id);
const ok=body=>({status:200,body});
const fail=(status,error,extra={})=>({status,body:{error,...extra}});

export function createHandlers({store,auth,secret,now=()=>new Date(),admins=[],payments=createPaymentProvider({})}){
  // Whoever runs the competition, by email (ARCADE_ADMIN_EMAILS). Nobody else can see or finalise results.
  const adminEmails=new Set([...admins].map(e=>String(e).trim().toLowerCase()).filter(Boolean));
  async function signedIn(token){
    const user=token?await auth.userFromToken(token):null;
    if(!user)return {error:fail(401,'Please sign in again.')};
    const player=await store.getPlayer(user.id);
    if(!player)return {error:fail(403,'This account has no arcade profile. Join with an invite code.')};
    return {user,player};
  }
  async function adminIn(token){
    const s=await signedIn(token);if(s.error)return s;
    if(!adminEmails.has(String(s.user.email||'').toLowerCase()))return {error:fail(403,'This account cannot run the competition.')};
    return s;
  }

  // The newest month an admin has finalised, with its archived podium. Nothing is shown to players before that,
  // so a month under review never puts a winner on the board.
  async function archivedPodium(){
    const months=await store.finalisedMonths();
    const month=months.at(-1)??null;
    return {month,rows:month?await store.monthResults(month):[]};
  }

  // One finished month for the admin page: the podium per game, the three prize winners with their emails, and
  // second and third kept separately as backups in case a winner's run is disqualified during review.
  // False until the month-end migration has run. Everything else works without it, so this only gates
  // finalising and puts a notice on the admin page.
  const monthEndReady=async()=>(await store.monthEndReady?.())??true;

  // Paid extra tries. False until supabase/paid-tries.sql has run: nobody has coins, no coin can be spent and
  // the shop stays hidden, while the boards, /api/me and the games carry on exactly as before.
  const coinsReady=async()=>Boolean(await store.coinsReady?.());
  // Card payments need their own migration (supabase/stripe.sql) for the columns a Checkout Session is
  // recorded in and the log that stops an event being acted on twice. Until it has run there is nowhere to
  // write any of that, so the shop stays hidden rather than taking a payment it could not account for. Every
  // other provider needs nothing, so this is true for them.
  const providerStoreReady=async()=>payments.id!=='stripe'||Boolean(await store.stripeReady?.());
  // The shop also needs somewhere for the money to go, so a half-configured deployment shows no shop at all
  // rather than a pack list that cannot be paid for.
  const shopReady=async()=>Boolean(payments.ready)&&await coinsReady()&&await providerStoreReady();
  const coinBalance=async playerId=>(await coinsReady())?Math.max(0,Number(await store.coinsFor(playerId))||0):0;
  const purchaseView=row=>({reference:row.reference,coins:Number(row.coins)||0,pack:Number(row.pack)||0,
    amount:Number(row.amount_cents)||0,price:formatAmount(row.amount_cents),currency:row.currency??COIN_CURRENCY,
    status:row.status,provider:row.provider,createdAt:row.created_at,resolvedAt:row.resolved_at??null});
  // What the provider calls this purchase, for the admin page only: the Stripe Checkout Session it was paid
  // on, and the payment a refund or a dispute would arrive under. Null on a bank transfer, and on a
  // deployment where supabase/stripe.sql has not run.
  const providerRefs=row=>({providerRef:row.provider_ref??null,providerPaymentRef:row.provider_payment_ref??null});
  // What the player is shown: their balance, anything still waiting for payment, and whatever was granted
  // recently so a "coins added" message can be shown once. Purchases older than this are history.
  const RECENT_MS=14*24*60*60*1000;
  async function wallet(playerId){
    const shop=await shopReady();
    // coinsReady is sent on its own because a balance of nil and no coin system at all look identical
    // from the browser, and only one of them should put a wallet on the screen.
    const base={coinsReady:false,coins:0,purchases:[],shop:{enabled:shop,provider:payments.id,packs:shop?packList():[],payment:shop?payments.describe():null}};
    if(!(await coinsReady()))return base;
    const rows=await store.playerPurchases(playerId,['pending','paid']);
    const cutoff=now().getTime()-RECENT_MS;
    return {...base,coinsReady:true,coins:await coinBalance(playerId),
      purchases:rows.filter(r=>r.status==='pending'||(Date.parse(r.resolved_at??'')||0)>cutoff).map(purchaseView)};
  }
  // The admin view of the money: what is waiting to be matched against the bank feed, every player's balance
  // for a by-hand adjustment, and the last of the ledger so an action can be seen to have happened.
  async function coinsView(){
    if(!(await coinsReady()))return {ready:false,pending:[],settled:[],players:[],ledger:[],provider:payments.id,
      paymentReady:Boolean(payments.ready),providerReady:await providerStoreReady(),
      needsAdminConfirmation:Boolean(payments.needsAdminConfirmation)};
    const pending=await store.purchasesByStatus(['pending']);
    // Paid, cancelled and refunded, newest first: this is where a refund is started from.
    const settled=(await store.purchasesByStatus(['paid','cancelled','refunded'])).slice(-20).reverse();
    const players=await store.allPlayers();
    const ids=[...new Set([...players.map(p=>p.id),...pending.map(p=>p.player_id),...settled.map(p=>p.player_id)])];
    const people=new Map(players.map(p=>[p.id,p]));
    const emails=new Map(((await auth.emailsByIds?.(ids))||[]).map(e=>[e.id,e.email]));
    const at=now().getTime();
    return {ready:true,provider:payments.id,paymentReady:Boolean(payments.ready),
      providerReady:await providerStoreReady(),
      needsAdminConfirmation:Boolean(payments.needsAdminConfirmation),
      pending:pending.map(row=>({...purchaseView(row),...providerRefs(row),id:row.id,player_id:row.player_id,
        name:people.get(row.player_id)?.name??'Player',email:emails.get(row.player_id)??null,
        ageMinutes:Math.max(0,Math.round((at-(Date.parse(row.created_at)||at))/60000))})),
      settled:settled.map(row=>({...purchaseView(row),...providerRefs(row),id:row.id,player_id:row.player_id,
        name:people.get(row.player_id)?.name??'Player',email:emails.get(row.player_id)??null,
        resolvedBy:row.resolved_by??null})),
      players:players.map(p=>({id:p.id,name:p.name,email:emails.get(p.id)??null,coins:Math.max(0,Number(p.coins)||0)})),
      ledger:(await store.coinLedger({limit:40})).map(r=>({delta:r.delta,reason:r.reason,note:r.note,
        admin_email:r.admin_email??null,created_at:r.created_at,
        name:people.get(r.player_id)?.name??'Player'}))};
  }

  // Whether arcade/supabase/admin-log.sql has run. The lists read tables that have always been there, so the
  // page still shows everything without it; only the actions need it, and they say so instead of acting.
  const adminLogReady=async()=>Boolean(await store.adminLogReady?.());
  // Whether flag-details.sql has run. Without it a flagged run shows the fixed sentence, as it always did.
  const flagDetailsReady=async()=>Boolean(await store.flagDetailsReady?.());
  // Whether flag-reasons.sql has run. Without it a flagged run has nowhere to keep why, so it shows the
  // one sentence the page showed when there was one way to be flagged.
  const flagReasonsReady=async()=>Boolean(await store.flagReasonsReady?.());
  const achievementsReady=async()=>Boolean(await store.achievementsReady?.());
  // Every achievement number a player has, from the runs the server itself verified. Rejected and refunded
  // runs are not here to be counted: a run rejected at verification never got a row, and one rejected later
  // loses its row with it.
  const playerTotals=async playerId=>
    (await achievementsReady()) ? totalsFrom(await store.playerRunStats(playerId)) : {};
  // Records what one verified segment earned and reports back anything that crossed a tier. A Sequence run
  // verifies one level at a time, so each level folds into that run's own row: a best keeps the higher
  // number, a lifetime tally adds up. Nothing here reads a number the browser sent.
  const recordAchievements=async(run,playerId,stats)=>{
    if(!stats||!(await achievementsReady()))return [];
    const before=await playerTotals(playerId);
    const existing=(await store.runStatsFor(run.id))?.stats??null;
    const merged=addRun(existing?{[run.game]:{...existing}}:{},run.game,stats)[run.game];
    if(!merged)return [];
    await store.saveRunStats({runId:run.id,playerId,game:run.game,stats:merged});
    return newlyEarned(before,await playerTotals(playerId));
  };
  // A whole number of uses for an invite code. The schema will not take zero or less.
  const cleanMaxUses=value=>{
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=1&&n<=10000?n:null;
  };
  // Why a run was flagged, in the words the flag was written in. Several reasons can sit on one run, so
  // this is a list; on a deployment that has not had flag-reasons.sql it is empty and the page falls back
  // to the single sentence that was true when there was only one way to be flagged.
  const flagReasonsOf=run=>{
    const rows=Array.isArray(run.flag_reasons)?run.flag_reasons:[];
    const clean=rows.filter(r=>r&&typeof r==='object'&&typeof r.text==='string'&&r.text)
      .map(r=>({code:String(r.code??'flag'),text:r.text}));
    return clean.length?clean:(run.flagged?[{code:'legacy',text:LEGACY_FLAG_REASON}]:[]);
  };

  // The runs worth a second look in one month: flagged, rejected, or both, with whoever played them.
  async function reviewRows({month,game,state}){
    const range=monthRange(month);
    const rows=await store.runsToReview({from:range.from,to:range.to,game,state});
    const ids=[...new Set(rows.map(r=>r.player_id))];
    const people=new Map((await store.playersByIds(ids)).map(p=>[p.id,p]));
    const emails=new Map(((await auth.emailsByIds?.(ids))||[]).map(e=>[e.id,e.email]));
    return rows.map(r=>({id:r.id,game:r.game,gameLabel:gameLabel(r.game),day:r.day,score:Math.max(0,Number(r.score)||0),
      name:people.get(r.player_id)?.name??'Player',email:emails.get(r.player_id)??null,
      flagged:Boolean(r.flagged),status:r.status,counts:r.status!=='rejected',
      reason:r.status==='rejected'?(r.reject_reason||'Rejected.'):(flagReasonsOf(r)[0]?.text??LEGACY_FLAG_REASON),
      // Every reason, so a run caught by two of them says both rather than only the first.
      reasons:r.status==='rejected'?[]:flagReasonsOf(r),
      claimedScore:r.claimed_score==null?null:Number(r.claimed_score),
      verifiedScore:r.verified_score==null?null:Number(r.verified_score),
      updatedAt:r.updated_at??null}));
  }

  // Whether a month has been finalised, which is what makes a rejection in it something to report rather
  // than something to act on.
  async function isFinalised(day){
    const month=String(day??'').slice(0,7);
    if(!cleanMonth(month))return false;
    return (await store.finalisedMonths()).includes(month);
  }

  // A finalised month whose published podium no longer stands.
  //
  // Rejecting a score after a month has been finalised deliberately leaves the public podium exactly as it
  // was: somebody has already been told they won, and that is not a thing to undo behind an admin's back. So
  // the month is reported here instead, with who would move up, and the admin decides by clicking Finalise
  // again.
  //
  // The test is made of stored outcomes only — a run's status and the score it was archived at — and never
  // puts a run back through today's scoring or ranking code. A podium row is stale when the player it names
  // no longer has a counting run in that month and game reaching the score it was archived at: something
  // that counted has stopped counting, which is a rejection or a refund and nothing else. Tie-breaks, the
  // points table and how many places a podium holds can all change later without marking one past month
  // stale, which is exactly what would happen if this re-derived each podium and compared it.
  //
  // Every finalised month is checked, with no window: two reads however many there are, because month_results
  // is nine rows a month and the runs come back in one span.
  async function staleFinalised(){
    const archived=await store.allMonthResults();
    if(!archived.length)return [];
    const months=[...new Set(archived.map(r=>r.month))].sort();
    const runs=await store.scoredRuns(`${months[0]}-01`,`${months.at(-1)}-31`);
    // The best score each player still has counting, per month and game. scoredRuns already leaves out
    // rejected runs and anything that never scored.
    const best=new Map();
    for(const r of runs){
      const key=`${String(r.day??'').slice(0,7)}|${r.game}|${r.player_id}`;
      best.set(key,Math.max(best.get(key)??0,Number(r.score)||0));
    }
    const stands=row=>(best.get(`${row.month}|${row.game}|${row.player_id}`)??0)>=(Number(row.score)||0);
    const groups=new Map();
    for(const row of archived){
      const key=`${row.month}|${row.game}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    const out=[];
    for(const [key,was] of groups){
      if(was.every(stands))continue;
      const [month,game]=key.split('|');
      // Only now, for a month already known to be stale, is a podium worked out — and only to say who would
      // move up if an admin re-finalised. Nothing here feeds the decision above.
      const now=monthPodium(runs.filter(r=>String(r.day??'').slice(0,7)===month),game);
      const ranked=new Map(was.map(r=>[r.player_id,r.rank]));
      const ids=[...new Set([...was,...now].map(r=>r.player_id))];
      const people=new Map((await store.playersByIds(ids)).map(p=>[p.id,p]));
      const name=id=>people.get(id)?.name??'Player';
      const winner=rows=>{const w=rows.find(r=>r.winner);return w?name(w.player_id):null;};
      out.push({month,monthLabel:monthLabel(month),game,gameLabel:gameLabel(game),
        archivedWinner:winner(was),liveWinner:winner(now),
        dropped:was.filter(r=>!stands(r)).map(r=>({name:name(r.player_id),rank:r.rank})),
        movesUp:now.filter(r=>!ranked.has(r.player_id)||r.rank<ranked.get(r.player_id))
          .map(r=>({name:name(r.player_id),from:ranked.get(r.player_id)??null,to:r.rank}))});
    }
    return out.sort((a,b)=>a.month.localeCompare(b.month)||a.game.localeCompare(b.game));
  }

  // Accounts that might be the same person twice: same invite code minutes apart, or the same mailbox
  // under different spellings. Display only — nothing here blocks a signup or touches a run.
  async function duplicatesView(){
    const players=await store.allPlayers();
    const directory=(await auth.allEmails?.())??(await auth.emailsByIds?.(players.map(p=>p.id)))??[];
    const emails=new Map(directory.map(e=>[e.id,e.email]));
    const totals=totalsIndex((await store.runTotalsByPlayer?.())??[]);
    return {players:players.length,groups:duplicateGroups({players,emails,totals})};
  }

  // Re-plays a stored run through the same verifier that let it in, and says whether it still produces the
  // score on the board. Nothing is written: this answers a question, it does not act on the answer.
  //
  // A Sequence run is a replay per level, so they go back through in the order they arrived, against the
  // seed each level was handed, and the scores add up the way the run's own total did.
  async function reverifyRun(run){
    const replays=Array.isArray(run.replays)?run.replays:[];
    if(!replays.length)return {ok:false,reason:'This run has no stored replay to check.',segments:[]};
    const segments=[];let replayed=0;
    for(let i=0;i<replays.length;i++){
      const level=i+1;
      try{
        // No elapsedSeconds: the clock checks belong to the moment of submission, and re-running them
        // against today's clock would say nothing. This asks the one question worth asking again — does
        // this replay still produce that score.
        const out=await verifySegment({game:run.game,replay:replays[i],level,
          seed:seedFor(secret,courseGame(run),run.day,level),rulesVersion:runVersion(run)});
        replayed+=out.score;
        segments.push({level,ok:true,score:out.score,moves:out.signals?.moves??null,
          gameSeconds:Math.round((out.gameSeconds??0)*10)/10});
      }catch(error){
        if(!(error instanceof RejectedRun))throw error;
        segments.push({level,ok:false,reason:error.message});
        return {ok:false,score:run.score,replayed,segments,reason:error.message};
      }
    }
    return {ok:replayed===run.score,score:run.score,replayed,segments};
  }

  // What to check before telling somebody they have won, with the status the stored run can already answer.
  // `action` means the only way to know is to press the button; nothing here is a verdict, it is a prompt.
  const CHECKLIST=[
    ['reverified','The run replays to the score on the board'],
    ['timing','The timing looks human'],
    ['flags','No open flags, or a flag cleared with a note'],
    ['history','The score is in line with the player&rsquo;s own history'],
    ['duplicate','The account is not a likely duplicate'],
    ['backups','2nd and 3rd are archived as backups'],
  ];
  function winnerChecklist({reasons,podiumSize,duplicate,wallSeconds}){
    const has=code=>reasons.some(r=>r.code===code);
    const state={
      reverified:{status:'action',detail:'Press Re-verify to check.'},
      timing:has('long-open')||has('fast-moves')
        ?{status:'warn',detail:reasons.filter(r=>['long-open','fast-moves'].includes(r.code)).map(r=>r.text).join(' ')}
        :{status:'ok',detail:Number.isFinite(wallSeconds)?`Played over ${formatDuration(wallSeconds)}.`:'No timing flag.'},
      flags:reasons.length?{status:'warn',detail:`${reasons.length} open flag${reasons.length===1?'':'s'}.`}
        :{status:'ok',detail:'Nothing flagged.'},
      history:has('score-outlier')
        ?{status:'warn',detail:reasons.find(r=>r.code==='score-outlier').text}
        :{status:'ok',detail:'No outlier against their own best.'},
      duplicate:duplicate?{status:'warn',detail:duplicate}:{status:'ok',detail:'No duplicate signal.'},
      backups:podiumSize>=3?{status:'ok',detail:'2nd and 3rd are on record.'}
        :{status:'warn',detail:`Only ${podiumSize} on the podium, so there is less to fall back on.`},
    };
    return CHECKLIST.map(([key,label])=>({key,label,...state[key]}));
  }

  // The month's podium with enough of each run beside it to judge before a prize goes out: the verified
  // score, how many inputs it took, how long it ran by the server's clock and in game time, and any flag.
  async function winnersView(month){
    const range=monthRange(month);
    const scored=await store.scoredRuns(range.from,range.to);
    const archived=await store.monthResults(month);
    const rows=archived.length?archived:monthResults(scored,month);
    if(!rows.length)return {month,ready:true,games:[]};
    // Which run each podium row stands on: that player's best in the month and game, earliest on a tie,
    // which is how the standings ranked them in the first place.
    const runFor=row=>scored
      .filter(r=>r.player_id===row.player_id&&r.game===row.game&&String(r.day??'').slice(0,7)===month)
      .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||String(a.updated_at).localeCompare(String(b.updated_at)))[0]??null;
    const picked=new Map(rows.map(row=>[`${row.game}|${row.player_id}`,runFor(row)?.id??null]));
    const full=new Map(((await store.runsByIds?.([...picked.values()].filter(Boolean)))??[]).map(r=>[r.id,r]));
    const ids=[...new Set(rows.map(r=>r.player_id))];
    const people=new Map((await store.playersByIds(ids)).map(p=>[p.id,p]));
    const emails=new Map(((await auth.emailsByIds?.(ids))||[]).map(e=>[e.id,e.email]));
    // One duplicate read for the whole page, so each winner can be told whether they are in a cluster.
    const clusters=(await duplicatesView()).groups;
    const clusterFor=playerId=>{
      const hit=clusters.find(g=>g.members.some(m=>m.player_id===playerId));
      if(!hit)return null;
      const others=hit.members.filter(m=>m.player_id!==playerId).map(m=>m.name).join(', ');
      return hit.kind==='invite-code'
        ?`Signed up on ${hit.code} within ${formatDuration(hit.spanSeconds)} of ${others}.`
        :`Shares a mailbox with ${others}.`;
    };
    const view=row=>{
      const run=full.get(picked.get(`${row.game}|${row.player_id}`))??null;
      const summary=run?summariseReplays(row.game,run.replays):{segments:0,moves:0,gameSeconds:null};
      const started=run?Date.parse(run.started_at??''):NaN,finished=run?Date.parse(run.finished_at??run.updated_at??''):NaN;
      const wallSeconds=Number.isFinite(started)&&Number.isFinite(finished)?Math.max(0,(finished-started)/1000):null;
      const reasons=run?flagReasonsOf(run):[];
      const duplicate=clusterFor(row.player_id);
      return {game:row.game,rank:row.rank,winner:Boolean(row.winner),player_id:row.player_id,
        name:people.get(row.player_id)?.name??'Player',email:emails.get(row.player_id)??null,
        score:Number(row.score)||0,runId:run?.id??null,status:run?.status??null,
        moves:summary.moves,segments:summary.segments,gameSeconds:summary.gameSeconds,
        wallSeconds,wallClock:Number.isFinite(wallSeconds)?formatDuration(wallSeconds):null,
        startedAt:run?.started_at??null,finishedAt:run?.finished_at??null,
        reasons,duplicate,
        checklist:row.winner?winnerChecklist({reasons,podiumSize:rows.filter(r=>r.game===row.game).length,
          duplicate,wallSeconds}):null};
    };
    const all=rows.map(view);
    return {month,ready:true,finalised:archived.length>0,
      games:COMPETITION.games.map(game=>({game,label:gameLabel(game),
        podium:all.filter(r=>r.game===game).sort((a,b)=>a.rank-b.rank)}))};
  }

  // The whole admin page in one object: the money, the runs to review, the invite codes and the admin log.
  async function adminViewBody(query,session){
    const month=cleanMonth(query?.month)??monthKey(now());
    const game=COMPETITION.games.includes(String(query?.game))?String(query.game):null;
    const state=['flagged','rejected'].includes(String(query?.state))?String(query.state):null;
    const ready=await adminLogReady();
    return {...await coinsView(),
      you:String(session?.user?.email||'').toLowerCase(),
      review:{ready,month,game,state,games:COMPETITION.games.map(g=>({game:g,label:gameLabel(g)})),
        details:await flagDetailsReady(),
        reasons:await flagReasonsReady(),
        stale:await staleFinalised(),
        runs:await reviewRows({month,game,state})},
      duplicates:await duplicatesView(),
      winners:await winnersView(month),
      invites:{ready,list:await store.listInvites()},
      actions:ready?await store.adminActions({limit:20}):[]};
  }

  async function resultsView(month){
    const archived=await store.monthResults(month);
    const range=monthRange(month);
    const rows=archived.length?archived:monthResults(await store.scoredRuns(range.from,range.to),month);
    const ids=[...new Set(rows.map(r=>r.player_id))];
    const people=new Map((await store.playersByIds(ids)).map(p=>[p.id,p]));
    const emails=new Map(((await auth.emailsByIds?.(ids))||[]).map(e=>[e.id,e.email]));
    const prizes=await store.prizes();
    const view=r=>({game:r.game,gameLabel:gameLabel(r.game),rank:r.rank,winner:Boolean(r.winner),player_id:r.player_id,
      name:people.get(r.player_id)?.name??'Player',bottle:people.get(r.player_id)?.bottle??BOTTLES[0],
      score:r.score,email:emails.get(r.player_id)??null});
    const all=rows.map(view);
    return {month,label:monthLabel(month),thisMonth:monthKey(now()),finished:month<monthKey(now()),ready:await monthEndReady(),
      finalised:archived.length>0,finalisedAt:archived[0]?.finalised_at??null,source:archived.length?'archive':'live',
      games:COMPETITION.games.map(game=>({game,label:gameLabel(game),prize:prizeLine(prizes,game),text:prizes[game]??'',
        podium:all.filter(r=>r.game===game).sort((a,b)=>a.rank-b.rank)})),
      winners:all.filter(r=>r.winner),backups:all.filter(r=>!r.winner).sort((a,b)=>a.rank-b.rank),
      finalisedMonths:await store.finalisedMonths()};
  }

  async function playsLeft(playerId,day){
    const used=await store.countRuns(playerId,day);
    return Object.fromEntries(COMPETITION.games.map(g=>[g,Math.max(0,COMPETITION.triesPerDay-(used[g]||0))]));
  }

  // Lifetime points (from every finished game) and whether the player has finished a past month in the top three.
  // Together they decide which bottles are unlocked.
  async function progress(playerId){
    const at=now(),monthStart=`${monthKey(at)}-01`;
    const points=(await store.finishedScores(playerId)).reduce((sum,score)=>sum+pointsForGame(score),0);
    const past=(await store.scoredRuns('2000-01-01',dayKey(at))).filter(r=>r.day<monthStart);
    return {points,podium:podiumMonths(past,playerId).length>0};
  }

  // A Sequence run's rules are read back from the seed it was started with, newest first, so a run already
  // in flight keeps the engine it began on and a new run cannot submit an easier older replay.
  const sequenceVersion=run=>{
   if(run.game!=='sequence')return 1;
   if(run.seed===seedFor(secret,'sequence-v4',run.day,1))return 4;
   if(run.seed===seedFor(secret,'sequence-v3',run.day,1))return 3;
   if(run.seed===seedFor(secret,'sequence-v2',run.day,1))return 2;
   return 1;
  };
  const ridgeVersion=run=>run.seed===seedFor(secret,'ridge-v6',run.day,1)?6:5;
  // Peak Blocks has one board rule set in play and its seed carries no version marker, so there is nothing
  // to read back off a run: the version is whatever the client ships, which is what verify.mjs then pins a
  // submitted replay to. Said plainly here rather than falling through to sequenceVersion, which answered
  // 1 for a Blocks run and so pinned nothing at all.
  const runVersion=run=>run.game==='ridge'?ridgeVersion(run)
    :run.game==='sequence'?sequenceVersion(run):BLOCKS_REPLAY_VERSION;
  const courseGame=run=>{
   if(run.game==='ridge'&&ridgeVersion(run)===6)return 'ridge-v6';
   if(run.game!=='sequence')return run.game;
   const version=sequenceVersion(run);
   return version===1?'sequence':`sequence-v${version}`;
  };

  async function finishView(run,playerId){
    const done=run.status!=='open',level=run.segments;
    const lastScore=run.replays?.length>1?null:run.score;
    const out={score:run.score,done,nextLevel:done?null:level+1,nextSeed:done?null:seedFor(secret,courseGame(run),run.day,level+1)};
    if(lastScore!==null)out.levelScore=lastScore;
    if(done){
      const month=String(run.day).slice(0,7),range=monthRange(month);
      const before=(await store.scoredRuns(range.from,range.to)).filter(r=>r.id!==run.id);
      const previousBest=before.filter(r=>r.player_id===playerId&&r.game===run.game).reduce((m,r)=>Math.max(m,r.score),0);
      const rows=run.score>0?[...before,{id:run.id,player_id:playerId,game:run.game,score:run.score,day:run.day,updated_at:run.updated_at}]:before;
      const table=gameStandings(rows,run.game),mine=table.find(r=>r.player_id===playerId);
      out.board={month,rank:mine?.rank??null,players:table.length,best:mine?.best??0,previousBest,newBest:run.score>0&&run.score>previousBest};
      out.plays=await playsLeft(playerId,dayKey(now()));
      out.coins=await coinBalance(playerId);
    }
    return out;
  }

  return {
    // New player: a valid invite code creates the account and emails a sign-in link. An email that already has an
    // account just gets a fresh sign-in link and keeps the code unused.
    async join({body,origin}){
      const email=cleanEmail(body?.email),code=cleanCode(body?.code),name=cleanName(body?.name);
      if(!email)return fail(400,'Enter a valid email address.');
      if(!name)return fail(400,'Choose a player name of at least 2 characters.');
      if(!code)return fail(400,'Enter your invite code.');
      if(!(await store.inviteAvailable(code)))return fail(403,'That invite code is not valid or has already been used.');
      const created=await auth.createUser(email);
      if(created.exists){await auth.sendLink(email,origin);return ok({sent:true,existing:true});}
      if(!(await store.useInvite(code))){await auth.deleteUser?.(created.id);return fail(403,'That invite code is not valid or has already been used.');}
      await store.createPlayer({id:created.id,name,bottle:BOTTLES[0],invite_code:code});
      await auth.sendLink(email,origin);
      return ok({sent:true});
    },

    async me({token}){
      const s=await signedIn(token);if(s.error)return s.error;
      const day=dayKey(now());
      const p=await progress(s.player.id);
      // Only a first place wins a prize, so only a first place raises the winner modal.
      const last=await archivedPodium();
      const wins=last.rows.filter(r=>r.winner&&r.player_id===s.player.id).map(r=>({game:r.game,month:last.month}));
      return ok({player:{name:s.player.name,bottle:s.player.bottle,points:p.points,podium:p.podium},email:s.user.email,day,triesPerDay:COMPETITION.triesPerDay,plays:await playsLeft(s.player.id,day),wins,admin:adminEmails.has(String(s.user.email||'').toLowerCase()),
        achievements:achievementState(await playerTotals(s.player.id)),achievementTotals:await playerTotals(s.player.id),...await wallet(s.player.id)});
    },

    async profile({token,body}){
      const s=await signedIn(token);if(s.error)return s.error;
      const patch={};
      if(body?.name!==undefined){const name=cleanName(body.name);if(!name)return fail(400,'Choose a player name of at least 2 characters.');patch.name=name;}
      if(body?.bottle!==undefined&&body.bottle!==s.player.bottle){
        if(!BOTTLES.includes(body.bottle))return fail(400,'Unknown bottle.');
        if(!bottleUnlocked(body.bottle,await progress(s.player.id)))return fail(403,'Earn more points to unlock this bottle.');
        patch.bottle=body.bottle;
      }
      const player=await store.updatePlayer(s.player.id,patch);
      return ok({player:{name:player.name,bottle:player.bottle}});
    },

    // Uses one of today's plays and hands out today's course. Counting and inserting happen in one locked
    // database call, so two quick taps can't both get the last play.
    async start({token,body}){
      const s=await signedIn(token);if(s.error)return s.error;
      const game=body?.game;if(!COMPETITION.games.includes(game))return fail(400,'That game is not in the competition.');
      const requestId=body?.requestId??null;
      if(requestId!==null&&(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)))return fail(400,'Invalid start request. Please reopen the game.');
      const day=dayKey(now()),seed=seedFor(secret,game==='sequence'?'sequence-v4':game==='ridge'?'ridge-v6':game,day,1);
      // Free tries first, then a coin if there is one. The store spends the coin and creates the run in one
      // step, so two taps with one coin left can only make one run.
      const run=await store.startRun({playerId:s.player.id,game,day,seed,limit:COMPETITION.triesPerDay,requestId,allowPaid:await coinsReady()});
      if(!run)return fail(409,'No free plays left for this game today. More tomorrow.',{plays:await playsLeft(s.player.id,day),coins:await coinBalance(s.player.id),shop:await shopReady()});
      if(run.game!==game||run.status!=='open'||run.segments>0)return fail(409,'This run has already been played. Please start a new one.');
      return ok({runId:run.id,game,seed:run.seed,level:1,rulesVersion:runVersion(run),paid:Boolean(run.paid),plays:await playsLeft(s.player.id,day),coins:await coinBalance(s.player.id)});
    },

    // Receives one finished game (or, in Sequence, one finished level), replays it, and adds the verified score.
    // A Sequence run stays open while levels are being cleared; each cleared level unlocks the next level's board.
    async finish({token,body}){
      const s=await signedIn(token);if(s.error)return s.error;
      const run=await store.getRun(String(body?.runId??''));
      if(!run||run.player_id!==s.player.id)return fail(404,'Run not found.');
      // A lost HTTP response is safe to retry. Only an identical replay already verified for this player qualifies.
      const duplicate=run.status!=='rejected'&&(run.replays||[]).some(rep=>isDeepStrictEqual(rep,body?.replay));
      if(duplicate)return ok(await finishView(run,s.player.id));
      if(run.status!=='open')return fail(409,'This run is already finished.');
      // The score the browser says it got. It is never used as the score — the replay below decides that —
      // but it is the whole of the claimed-against-verified comparison, and so the only thing that puts a
      // doctored run on the review page. Leaving it optional meant a run could dodge that comparison
      // simply by not sending the field, which is the one move a cheat would always make. So it is
      // required. Nothing honest is turned away: every finished game posts it (ui/app.js submitRanked),
      // and the pending-result retry resends the same body, claim included.
      if(!Number.isFinite(body?.claimed))return fail(400,'This score could not be submitted. Please try again.');
      const level=run.segments+1;
      if(run.game!=='sequence'&&run.segments>0)return fail(409,'This run is already finished.');
      const at=now(),elapsedSeconds=(at-Date.parse(run.updated_at))/1000;
      let result;
      try{result=await verifySegment({game:run.game,replay:body?.replay,seed:seedFor(secret,courseGame(run),run.day,level),level,elapsedSeconds,rulesVersion:runVersion(run)});}
      catch(error){
        if(!(error instanceof RejectedRun))throw error;
        await store.updateRunIf(run.id,run.segments,{status:'rejected',reject_reason:error.message,updated_at:at.toISOString(),finished_at:at.toISOString()});
        return fail(422,'This run could not be verified, so it does not count.',{reason:error.message});
      }
      const done=run.game!=='sequence'||!result.won,score=run.score+result.score;
      const claimed=body.claimed,mismatch=claimed!==result.score;
      // Everything about this run that is worth a person's attention, worked out from the replay just
      // played and from the server's own clock. A reason never rejects the run, never changes the score
      // and never moves it on a board: the score below is the verified one either way, and the run goes on
      // counting until an admin decides otherwise. All a reason does is put the run in Runs to review with
      // a sentence saying what looked odd.
      // This segment's own clock: the run's start for the first, the previous segment's finish for the
      // rest. updated_at is written on every verified segment, so for a Sequence level it is exactly when
      // the level before it landed.
      const segmentStart=Date.parse(run.segments>0?run.updated_at:(run.started_at??run.updated_at));
      const reasons=mergeReasons(run.flag_reasons,runFlags({
        game:run.game,claimed,verified:result.score,
        segmentSeconds:(at-segmentStart)/1000,segment:level,
        history:await store.playerGameScores?.(s.player.id,run.game,run.id),
        moves:result.signals?.moves,
        medianGapSeconds:result.signals?.medianGapSeconds,
        // Peak Blocks logs no tick, so its pace is the run's own wall time over its placements. Anything
        // under a quarter-second a placement was already refused at verification; this is the band above it.
        wallSecondsPerMove:run.game==='blocks'&&result.signals?.moves>0
          ?((at-Date.parse(run.started_at??run.updated_at))/1000)/result.signals.moves:undefined,
      }));
      const flagged=run.flagged||reasons.length>0;
      // What the browser claimed against what the replay produced, both as the run's running total so they
      // compare with each other and with the score on the board. Only written once flag-details.sql has run;
      // claimed_score only when a claim disagreed, so an honest later segment cannot wipe an earlier gap.
      const detail=(await flagDetailsReady())
        ?{verified_score:score,...(mismatch?{claimed_score:run.score+claimed}:{})}
        :{};
      // The reasons need their own migration, and until it has run there is nowhere to put them: the run is
      // still flagged, still listed and still reviewable, and the page says the one sentence it always did.
      const reasonPatch=(await flagReasonsReady())?{flag_reasons:reasons}:{};
      const updated=await store.updateRunIf(run.id,run.segments,{segments:level,score,level,status:done?'closed':'open',flagged,...detail,...reasonPatch,updated_at:at.toISOString(),finished_at:done?at.toISOString():null,replays:[...(run.replays||[]),body.replay]});
      if(!updated){
        const latest=await store.getRun(run.id);
        if(latest?.status!=='rejected'&&(latest?.replays||[]).some(rep=>isDeepStrictEqual(rep,body.replay)))return ok(await finishView(latest,s.player.id));
        return fail(409,'This run was already updated.');
      }
      const earned=await recordAchievements(run,s.player.id,result.stats);
      return ok({...await finishView({...run,score,segments:level,level,status:done?'closed':'open',updated_at:at.toISOString()},s.player.id),levelScore:result.score,earned,
        achievements:achievementState(await playerTotals(s.player.id))});
    },

    // With a game, that game's board: best scores this month or year. Without one, the overall rank-points table.
    async leaderboard({token,query}){
      const s=await signedIn(token);if(s.error)return s.error;
      const period=query?.period==='yearly'?'yearly':'monthly',at=now();
      const game=COMPETITION.games.includes(query?.game)?query.game:null;
      const key=period==='yearly'?yearKey(at):monthKey(at),range=period==='yearly'?yearRange(key):monthRange(key);
      const runs=await store.scoredRuns(range.from,range.to);
      const table=game?gameStandings(runs,game):period==='yearly'?yearlyStandings(runs):monthlyStandings(runs);
      const shown=table.slice(0,20),mine=table.find(r=>r.player_id===s.player.id)??null;
      // Last month's podium rides along with the board: first place won the prize, second and third are runners-up.
      const last=await archivedPodium();
      const lastRows=game?last.rows.filter(r=>r.game===game).sort((a,b)=>a.rank-b.rank):[];
      const ids=[...new Set([...shown.map(r=>r.player_id),...(mine?[mine.player_id]:[]),...lastRows.map(r=>r.player_id)])];
      const people=new Map((await store.playersByIds(ids)).map(p=>[p.id,p]));
      const view=r=>({rank:r.rank,name:people.get(r.player_id)?.name??'Player',bottle:people.get(r.player_id)?.bottle??BOTTLES[0],points:r.points,games:r.games,you:r.player_id===s.player.id});
      const past=r=>({rank:r.rank,winner:Boolean(r.winner),name:people.get(r.player_id)?.name??'Player',bottle:people.get(r.player_id)?.bottle??BOTTLES[0],score:r.score,you:r.player_id===s.player.id});
      const prizes=await store.prizes();
      const lines=Object.fromEntries(COMPETITION.games.map(g=>[g,prizeLine(prizes,g)]));
      return ok({period,key,game,players:table.length,top:shown.map(view),me:mine?view(mine):null,
        prize:game?lines[game]:null,prizes:lines,
        lastMonth:lastRows.length?{month:last.month,label:monthLabel(last.month),podium:lastRows.map(past)}:null});
    },

    // Admin: one month's podium, its three prize winners and the runners-up kept as backups. Before the month is
    // finalised this is worked out live from the runs, so results can be checked before anyone is told they won.
    async results({token,query}){
      const s=await adminIn(token);if(s.error)return s.error;
      const month=cleanMonth(query?.month)??previousMonth(monthKey(now()));
      return ok(await resultsView(month));
    },

    // Admin: writes the month's podium and marks its winners, which is what raises the winner modal and puts
    // last month's winners on the boards. Safe to run again after a disqualification: it replaces that month's
    // rows. Prize text can be saved on its own by leaving the month out.
    async finalise({token,body}){
      const s=await adminIn(token);if(s.error)return s.error;
      const month=cleanMonth(body?.month);
      if(body?.month!==undefined&&!month)return fail(400,'Pick a month as YYYY-MM.');
      if(!(await monthEndReady()))return fail(503,new MonthEndNotReady().message);
      if(body?.prizes!==undefined){
        if(!body.prizes||typeof body.prizes!=='object'||Array.isArray(body.prizes))return fail(400,'Prize text must be one line per game.');
        for(const game of Object.keys(body.prizes))if(!COMPETITION.games.includes(game))return fail(400,'That game is not in the competition.');
      }
      if(month&&month>=monthKey(now()))return fail(400,'That month has not finished yet.');
      if(!month&&body?.prizes===undefined)return fail(400,'Pick a month as YYYY-MM.');
      // The tables can still go missing between the check above and the write, so the write says so too.
      try{
        if(body?.prizes!==undefined)for(const [game,text] of Object.entries(body.prizes))await store.setPrize(game,cleanPrize(text));
        if(month){
          const range=monthRange(month);
          await store.saveMonthResults(month,monthResults(await store.scoredRuns(range.from,range.to),month));
        }
      }catch(error){
        if(error instanceof MonthEndNotReady)return fail(503,error.message);
        throw error;
      }
      return ok(await resultsView(month??previousMonth(monthKey(now()))));
    },

    // A player asks to buy a pack. The pack is chosen by its coin count and priced here, so a browser can
    // never name its own price. Nothing is granted: this hands back a reference to pay against.
    async buy({token,body,origin}){
      const s=await signedIn(token);if(s.error)return s.error;
      if(!(await shopReady()))return fail(503,'Extra tries are not on sale yet.');
      const coins=cleanPackCoins(body?.coins);
      if(!coins)return fail(400,'Choose one of the coin packs.');
      const pack=packFor(coins);
      const waiting=await store.playerPurchases(s.player.id,['pending']);
      if(waiting.length>=MAX_PENDING_PURCHASES){
        // A hosted checkout the player walked away from is not a reason to refuse them. The provider is asked
        // what became of it: still open means the same page again, expired means that attempt is dead and this
        // one replaces it, and paid-but-not-granted-yet means the coins are already on their way.
        let again=null;
        if(payments.resume)try{again=await payments.resume(waiting[0],{origin});}catch{again=null;}
        if(again?.status==='pending'&&again.instructions)
          return ok({purchase:purchaseView(waiting[0]),instructions:again.instructions,coins:await coinBalance(s.player.id)});
        if(again?.status==='processing')
          return fail(409,'Your payment is being confirmed. Your coins will appear in a moment.',{purchase:purchaseView(waiting[0])});
        if(again?.status==='expired')await store.cancelPurchase(waiting[0].id,payments.id);
        else return fail(409,'You already have a payment waiting. Finish that one, or ask us to cancel it, before starting another.',{purchase:purchaseView(waiting[0])});
      }
      let created=null;
      try{
        // The reference is random, so a clash is rare and a unique index catches it; try again with a new one.
        for(let attempt=0;attempt<6&&!created;attempt++){
          try{
            created=await store.createPurchase({playerId:s.player.id,pack:pack.coins,coins:pack.coins,
              amountCents:pack.cents,currency:COIN_CURRENCY,reference:newReference(),provider:payments.id});
          }catch(error){
            if(error instanceof CoinsNotReady)throw error;
            if(attempt===5||!/duplicate|unique/i.test(String(error.message)))throw error;
          }
        }
        const begun=await payments.begin(created,{origin});
        // What the provider calls this purchase, written down before the player is sent anywhere, so a
        // webhook that arrives about a payment with no metadata can still be traced to it.
        if(begun?.providerRef&&store.setPurchaseRefs)await store.setPurchaseRefs(created.id,{sessionId:begun.providerRef});
        // A provider that takes the money itself reports 'paid' and the coins are granted now; the manual
        // provider always reports 'pending' and an admin grants them once the transfer lands. Stripe reports
        // 'pending' too: its coins are granted by the webhook, never by this request and never by the
        // redirect the player comes back on.
        if(begun?.status==='paid')await store.grantPurchase(created.id,payments.id);
        return ok({purchase:purchaseView(await store.purchaseById(created.id)??created),
          instructions:begun?.instructions??null,coins:await coinBalance(s.player.id)});
      }catch(error){
        if(error instanceof CoinsNotReady)return fail(503,error.message);
        if(error instanceof StripeNotReady)return fail(503,error.message);
        // The row exists but there is nothing to pay it with, so it is closed rather than left to block the
        // next attempt: one payment at a time means a failed checkout must not cost the player the shop.
        if(created&&error instanceof StripeError){
          await store.cancelPurchase(created.id,payments.id).catch(()=>{});
          console.error('[api/buy] Stripe would not open a checkout',error);
          return fail(502,'Card payments could not be set up just now. Nothing has been charged. Please try again.');
        }
        throw error;
      }
    },

    // Everything an admin does, behind one route. A deployment is limited in how many functions it may have,
    // and one per action would be seven of them, so /api/admin carries them all: GET is the whole view and
    // POST says which action it is. /api/money still reaches this, through a rewrite in arcade/vercel.json.
    // The handlers below stay separate because that is how they are tested.
    async admin({token,body,query,method}){
      if(String(method??'POST').toUpperCase()!=='POST')return this.adminView({token,query});
      const action=String(body?.action??'');
      if(!action)return fail(400,'Unknown action.');
      const out=['clear-flag','reject','re-verify'].includes(action)?await this.review({token,body})
        :['invite-create','invite-max-uses'].includes(action)?await this.invites({token,body})
        :action==='adjust'?await this.coins({token,body})
        :await this.purchase({token,body});
      // Every action answers with the whole page again, worked out after the change, so no panel is left
      // showing what was true before it. What the action itself reported stays on top.
      if(out.status!==200)return out;
      const s=await adminIn(token);
      return s.error?out:ok({...await adminViewBody(query,s),...out.body});
    },
    // Kept so anything still calling /api/money reaches the same place.
    async money(context){return this.admin(context);},

    // Admin: the whole admin page in one read — the money, the runs worth a second look, the invite codes,
    // and the last of the admin log.
    async adminView({token,query}){
      const s=await adminIn(token);if(s.error)return s.error;
      return ok(await adminViewBody(query,s));
    },

    // Admin: clear a flag (the run keeps counting) or reject a run (it stops counting anywhere). Both are
    // conditional on the run not already being in that state, so a second click changes and logs nothing.
    async review({token,body}){
      const s=await adminIn(token);if(s.error)return s.error;
      const action=String(body?.action??'');
      if(!['clear-flag','reject','re-verify'].includes(action))return fail(400,'Unknown action.');
      const id=String(body?.id??'');
      if(!id)return fail(400,'Which run?');
      // Re-verify changes nothing, so it needs no note and no admin log: it re-plays the stored replay and
      // reports whether it still produces the score on the board. It sits here because it is the same
      // question the review page exists to ask.
      if(action==='re-verify'){
        const run=await store.getRun(id);
        if(!run)return fail(404,'That run is not there.');
        return ok({action,result:{id,...await reverifyRun(run)}});
      }
      const note=cleanNote(body?.note);
      if(action==='reject'&&!note)return fail(400,'Write a short note saying why it was rejected.');
      if(!(await adminLogReady()))return fail(503,new AdminLogNotReady().message);
      try{
        // Whether this run sits in a month that has already been published, which the log records and the
        // page then reports. Read before the change, so a rejection cannot hide where it landed.
        const existing=await store.getRun(id);
        const afterFinalise=action==='reject'&&Boolean(existing)&&await isFinalised(existing.day);
        const result=await store.reviewRun(id,{action:action==='reject'?'reject':'clear',
          note:note??'',adminEmail:String(s.user.email||'').toLowerCase(),afterFinalise});
        if(!result?.found)return fail(404,'That run is not there.');
        // The archived podium is deliberately left alone: somebody has already been told they won. The page
        // says the month needs re-finalising and waits for an admin to decide.
        const needsRefinalise=result.changed&&afterFinalise
          ?{month:String(result.run?.day??'').slice(0,7),game:result.run?.game??null}:null;
        return ok({action,result:{...result,needsRefinalise}});
      }catch(error){
        if(error instanceof AdminLogNotReady)return fail(503,error.message);
        throw error;
      }
    },

    // Admin: make a new invite code, or change how many times an existing one may be used.
    async invites({token,body}){
      const s=await adminIn(token);if(s.error)return s.error;
      const action=String(body?.action??'');
      if(!['invite-create','invite-max-uses'].includes(action))return fail(400,'Unknown action.');
      const code=cleanCode(body?.code);
      if(!code)return fail(400,'Enter a code. Letters, numbers and dashes.');
      const maxUses=cleanMaxUses(body?.maxUses);
      if(maxUses===null)return fail(400,'How many times may it be used? A whole number from 1 to 10000.');
      if(!(await adminLogReady()))return fail(503,new AdminLogNotReady().message);
      const who=String(s.user.email||'').toLowerCase();
      try{
        if(action==='invite-create'){
          const result=await store.createInvite({code,maxUses,note:cleanPrize(body?.note??''),adminEmail:who});
          return ok({action,result});
        }
        const result=await store.setInviteMaxUses(code,maxUses,who);
        if(!result?.found)return fail(404,'There is no code with that name.');
        return ok({action,result});
      }catch(error){
        if(error instanceof AdminLogNotReady)return fail(503,error.message);
        throw error;
      }
    },

    // Admin: what is waiting for payment, everyone's balance, and the last of the ledger.
    async purchases({token}){
      const s=await adminIn(token);if(s.error)return s.error;
      return ok(await coinsView());
    },

    // Admin: mark a purchase paid (which grants the coins), cancel it, or refund it. Every one of these is a
    // single database function, so clicking twice cannot grant twice.
    async purchase({token,body}){
      const s=await adminIn(token);if(s.error)return s.error;
      const action=String(body?.action??'');
      if(!['paid','cancel','refund'].includes(action))return fail(400,'Unknown action.');
      const id=String(body?.id??'');
      if(!id)return fail(400,'Which purchase?');
      if(!(await coinsReady()))return fail(503,new CoinsNotReady().message);
      const who=String(s.user.email||'').toLowerCase();
      try{
        const result=action==='paid'?await store.grantPurchase(id,who)
          :action==='cancel'?await store.cancelPurchase(id,who)
          :await store.refundPurchase(id,who);
        if(!result?.found)return fail(404,'That purchase is not there.');
        return ok({action,result,...await coinsView()});
      }catch(error){
        if(error instanceof CoinsNotReady)return fail(503,error.message);
        throw error;
      }
    },

    // Admin: give or take coins by hand, with a note. Never goes below zero.
    async coins({token,body}){
      const s=await adminIn(token);if(s.error)return s.error;
      const delta=cleanDelta(body?.delta),note=cleanNote(body?.note),playerId=String(body?.player??'');
      if(delta===null)return fail(400,'Enter how many coins to give or take, as a whole number that is not zero.');
      if(!note)return fail(400,'Write a short note saying why.');
      if(!playerId||!(await store.getPlayer(playerId)))return fail(404,'That player is not there.');
      if(!(await coinsReady()))return fail(503,new CoinsNotReady().message);
      try{
        const result=await store.adjustCoins(playerId,delta,note,String(s.user.email||'').toLowerCase());
        if(!result?.found)return fail(404,'That player is not there.');
        return ok({action:'adjust',result,...await coinsView()});
      }catch(error){
        if(error instanceof CoinsNotReady)return fail(503,error.message);
        throw error;
      }
    },
  };
}
