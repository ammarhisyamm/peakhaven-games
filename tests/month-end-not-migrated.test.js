// A deployment that has not run arcade/supabase/month-end.sql has no month_results or month_prizes table.
// Everything except finalising a month must keep working there: the leaderboard, /api/me, starting and
// finishing games, the default prize line, and no "Last month's winners". Uses the in-memory store and auth,
// with the month-end tables taken away, so no network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks,createPlanner} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial}=await import('../dist/tryout-games.js');
const {SIM_STEP}=await import('../dist/rng.js');
const {MonthEndNotReady,tableMissing,dayKey}=await import('../arcade/server/competition.mjs');
const {PRIZE_FALLBACK}=await import('../arcade/ui/month-prizes.js');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');

const SECRET='test-secret',ADMIN='boss@peak.test';

// The store as it behaves before the migration: the reads fall back the way supabase-store.mjs makes them
// fall back, and the writes raise MonthEndNotReady.
function withoutMonthEndTables(store){
  return {...store,
    async monthResults(){return [];},
    async finalisedMonths(){return [];},
    async prizes(){return {};},
    async monthEndReady(){return false;},
    async saveMonthResults(){throw new MonthEndNotReady();},
    async setPrize(){throw new MonthEndNotReady();},
  };
}

function world({migrated=false,start='2026-10-14T01:00:00Z'}={}){
  let t=Date.parse(start);const now=()=>new Date(t);
  const base=createMemoryStore({invites:{TEAM:20},now}),auth=createMemoryAuth();
  const store=migrated?base:withoutMonthEndTables(base);
  const api=createHandlers({store,auth,secret:SECRET,now,admins:[ADMIN]});
  let n=0;
  return {store:base,auth,api,now,advance:s=>{t+=s*1000;},
    async join(email,name){
      const r=await api.join({body:{email,name,code:'TEAM'},origin:'https://example.test'});
      assert.equal(r.status,200,JSON.stringify(r.body));
      return {token:auth.tokenFor(email),id:[...auth.users.values()].find(u=>u.email===email).id,email,name};
    },
    score(player,game,points,day='2026-09-10'){
      const id=`run-${++n}`;
      base.runs.set(id,{id,player_id:player.id,game,day,score:points,status:'closed',segments:1,flagged:false,updated_at:`${day}T0${n%9}:00:00Z`});
    }};
}

test('A missing table is recognised however PostgREST reports it',()=>{
  assert.equal(tableMissing({code:'42P01',message:'relation "public.month_results" does not exist'}),true,'Postgres undefined_table');
  assert.equal(tableMissing({code:'PGRST205',message:"Could not find the table 'public.month_prizes' in the schema cache"}),true,'PostgREST schema cache');
  assert.equal(tableMissing({message:'Could not find the table'}),true);
  assert.equal(tableMissing({code:'23505',message:'duplicate key value violates unique constraint'}),false,'a real error still has to surface');
  assert.equal(tableMissing({code:'42501',message:'permission denied for table month_results'}),false);
  assert.equal(tableMissing(null),false);
  assert.equal(tableMissing(undefined),false);
  assert.match(new MonthEndNotReady().message,/month-end\.sql/,'the message says which file to run');
});

test('Without the tables the leaderboard still works, with the default prize line and no podium',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann'),ben=await w.join('ben@x.com','Ben');
  w.score(ann,'blocks',4000);w.score(ben,'blocks',3000,'2026-10-02');
  const board=(await w.api.leaderboard({token:ann.token,query:{game:'blocks'}})).body;
  assert.equal(board.prize,PRIZE_FALLBACK,'a board still says what first place wins');
  assert.equal(board.prizes.sequence,PRIZE_FALLBACK);
  assert.equal(board.lastMonth,null,'no podium without the archive');
  assert.deepEqual(board.top.map(r=>r.name),['Ben'],'this month\'s standings are unaffected');
  const overall=(await w.api.leaderboard({token:ann.token,query:{}})).body;
  assert.equal(overall.prize,null);assert.equal(overall.prizes.ridge,PRIZE_FALLBACK);
  const yearly=(await w.api.leaderboard({token:ben.token,query:{period:'yearly',game:'blocks'}})).body;
  assert.equal(yearly.period,'yearly');assert.equal(yearly.lastMonth,null);
});

test('Without the tables /api/me works and nobody is told they won',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  w.score(ann,'ridge',500);
  const me=(await w.api.me({token:ann.token})).body;
  assert.deepEqual(me.wins,[],'no winner message without an archive to read');
  assert.equal(me.admin,false);
  assert.deepEqual(me.plays,{blocks:3,sequence:3,ridge:3});
  assert.equal(me.player.name,'Ann');
  assert.equal(me.day,dayKey(w.now()));
  assert.equal((await w.api.me({token:(await w.join(ADMIN,'Boss')).token})).body.admin,true);
});

test('Without the tables a game still starts, verifies and scores',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  const s=await w.api.start({token:ann.token,body:{game:'ridge'}});
  assert.equal(s.status,200);
  const out=stubCallbacks(),e=new RidgeEngine(stubCanvas(),out.cb,{seed:s.body.seed,motion:false}),bot=createPlanner(RIDGE,hitsVial);
  e.action();
  while(!e.dead&&!e.ended&&e.gatesPassed<4){if(bot.decide(e))e.action();for(let i=0;i<bot.every&&!e.dead;i++)e.step(SIM_STEP);}
  e.finish();e.destroy();
  w.advance(e.ticks*SIM_STEP+2);
  const f=await w.api.finish({token:ann.token,body:{runId:s.body.runId,replay:out.result.replay,claimed:out.result.score}});
  assert.equal(f.status,200,JSON.stringify(f.body));
  assert.equal(f.body.score,out.result.score);
  assert.equal(f.body.done,true);
  assert.equal(f.body.board.rank,1,'the finished-run board still reports a place');
});

test('Without the tables the admin page says to run the migration, and finalising is refused',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  w.score(ann,'blocks',4000);
  const view=(await w.api.results({token:admin.token,query:{}})).body;
  assert.equal(view.status,undefined);
  assert.equal(view.ready,false,'the page knows the tables are missing');
  assert.equal(view.month,'2026-09');
  assert.equal(view.finalised,false);

  for(const body of [{month:'2026-09'},{prizes:{blocks:'A free product'}},{month:'2026-09',prizes:{blocks:'A free product'}}]){
    const r=await w.api.finalise({token:admin.token,body});
    assert.equal(r.status,503,JSON.stringify(body));
    assert.match(r.body.error,/month-end\.sql/,'the refusal names the file to run');
  }
  // Still refused for a non-admin, and still 400 for nonsense, so the new check has not reordered anything.
  assert.equal((await w.api.finalise({token:ann.token,body:{month:'2026-09'}})).status,403);
  assert.equal((await w.api.finalise({token:null,body:{month:'2026-09'}})).status,401);
});

test('A write that fails after the check still answers with the migration message',async()=>{
  // The tables can go missing between the readiness check and the write, so the write path says so too.
  const w=world({migrated:true}),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  w.score(ann,'blocks',4000);
  w.store.saveMonthResults=async()=>{throw new MonthEndNotReady();};
  const r=await w.api.finalise({token:admin.token,body:{month:'2026-09'}});
  assert.equal(r.status,503);
  assert.match(r.body.error,/month-end\.sql/);
  // A different store failure is still a real error, not a polite 503.
  w.store.saveMonthResults=async()=>{throw new Error('connection reset');};
  await assert.rejects(()=>w.api.finalise({token:admin.token,body:{month:'2026-09'}}),/connection reset/);
});

test('Once the migration has run, everything works as before',async()=>{
  const w=world({migrated:true}),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann'),ben=await w.join('ben@x.com','Ben');
  w.score(ann,'blocks',4000);w.score(ben,'blocks',3000);
  assert.equal((await w.api.results({token:admin.token,query:{}})).body.ready,true);
  const done=await w.api.finalise({token:admin.token,body:{month:'2026-09',prizes:{blocks:'A free product'}}});
  assert.equal(done.status,200);
  assert.equal(done.body.winners.length,1);
  assert.deepEqual((await w.api.me({token:ann.token})).body.wins,[{game:'blocks',month:'2026-09'}]);
  const board=(await w.api.leaderboard({token:ann.token,query:{game:'blocks'}})).body;
  assert.equal(board.prize,'A free product');
  assert.equal(board.lastMonth.podium[0].winner,true);
});
