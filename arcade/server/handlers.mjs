// The competition API, written against two small interfaces so it can be tested without a network:
//   auth:  userFromToken(token), createUser(email), sendLink(email, redirectTo)
//   store: see supabase-store.mjs (memory-store.mjs in the tests implements the same calls)
import {COMPETITION,dayKey,monthKey,yearKey,monthRange,yearRange,seedFor,cleanName,cleanEmail,cleanCode,monthlyStandings,yearlyStandings,gameStandings,podiumMonths} from './competition.mjs';
import {BOTTLE_SKINS,pointsForGame,bottleUnlocked} from '../ui/bottle-unlocks.js';
import {verifySegment,RejectedRun} from './verify.mjs';

export const BOTTLES=BOTTLE_SKINS.map(b=>b.id);
const ok=body=>({status:200,body});
const fail=(status,error,extra={})=>({status,body:{error,...extra}});

export function createHandlers({store,auth,secret,now=()=>new Date()}){
  async function signedIn(token){
    const user=token?await auth.userFromToken(token):null;
    if(!user)return {error:fail(401,'Please sign in again.')};
    const player=await store.getPlayer(user.id);
    if(!player)return {error:fail(403,'This account has no arcade profile. Join with an invite code.')};
    return {user,player};
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
      return ok({player:{name:s.player.name,bottle:s.player.bottle,points:p.points,podium:p.podium},email:s.user.email,day,triesPerDay:COMPETITION.triesPerDay,plays:await playsLeft(s.player.id,day)});
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
      const day=dayKey(now()),seed=seedFor(secret,game,day,1);
      const run=await store.startRun({playerId:s.player.id,game,day,seed,limit:COMPETITION.triesPerDay});
      if(!run)return fail(409,'No free plays left for this game today. More tomorrow.',{plays:await playsLeft(s.player.id,day)});
      return ok({runId:run.id,game,seed,level:1,plays:await playsLeft(s.player.id,day)});
    },

    // Receives one finished game (or, in Sequence, one finished level), replays it, and adds the verified score.
    // A Sequence run stays open while levels are being cleared; each cleared level unlocks the next level's board.
    async finish({token,body}){
      const s=await signedIn(token);if(s.error)return s.error;
      const run=await store.getRun(String(body?.runId??''));
      if(!run||run.player_id!==s.player.id)return fail(404,'Run not found.');
      if(run.status!=='open')return fail(409,'This run is already finished.');
      const level=run.segments+1;
      if(run.game!=='sequence'&&run.segments>0)return fail(409,'This run is already finished.');
      const at=now(),elapsedSeconds=(at-Date.parse(run.updated_at))/1000;
      let result;
      try{result=await verifySegment({game:run.game,replay:body?.replay,seed:seedFor(secret,run.game,run.day,level),level,elapsedSeconds});}
      catch(error){
        if(!(error instanceof RejectedRun))throw error;
        await store.updateRunIf(run.id,run.segments,{status:'rejected',reject_reason:error.message,updated_at:at.toISOString(),finished_at:at.toISOString()});
        return fail(422,'This run could not be verified, so it does not count.',{reason:error.message});
      }
      const done=run.game!=='sequence'||!result.won,score=run.score+result.score;
      const claimed=Number(body?.claimed);
      const flagged=run.flagged||(Number.isFinite(claimed)&&claimed!==result.score);
      // For the end-of-run screen: where this run puts the player on this month's board for the game, and whether
      // it beats their earlier best this month. Read before the update so this run's own earlier levels are excluded.
      const month=String(run.day).slice(0,7),range=monthRange(month);
      const before=done?(await store.scoredRuns(range.from,range.to)).filter(r=>r.id!==run.id):null;
      const updated=await store.updateRunIf(run.id,run.segments,{segments:level,score,level,status:done?'closed':'open',flagged,updated_at:at.toISOString(),finished_at:done?at.toISOString():null,replays:[...(run.replays||[]),body.replay]});
      if(!updated)return fail(409,'This run was already updated.');
      const out={score,levelScore:result.score,done,nextLevel:done?null:level+1,nextSeed:done?null:seedFor(secret,run.game,run.day,level+1)};
      if(done){
        const previousBest=before.filter(r=>r.player_id===s.player.id&&r.game===run.game).reduce((m,r)=>Math.max(m,r.score),0);
        const rows=score>0?[...before,{id:run.id,player_id:s.player.id,game:run.game,score,day:run.day,updated_at:at.toISOString()}]:before;
        const table=gameStandings(rows,run.game),mine=table.find(r=>r.player_id===s.player.id);
        out.board={month,rank:mine?.rank??null,players:table.length,best:mine?.best??0,previousBest,newBest:score>0&&score>previousBest};
        out.plays=await playsLeft(s.player.id,dayKey(at));
      }
      return ok(out);
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
      const ids=[...new Set([...shown.map(r=>r.player_id),...(mine?[mine.player_id]:[])])];
      const people=new Map((await store.playersByIds(ids)).map(p=>[p.id,p]));
      const view=r=>({rank:r.rank,name:people.get(r.player_id)?.name??'Player',bottle:people.get(r.player_id)?.bottle??BOTTLES[0],points:r.points,games:r.games,you:r.player_id===s.player.id});
      return ok({period,key,game,players:table.length,top:shown.map(view),me:mine?view(mine):null});
    },
  };
}
