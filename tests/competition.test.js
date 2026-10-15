// Leaderboard competition: Melbourne days, shared daily courses, rank points, and the API that only counts
// scores it has replayed itself. Uses the in-memory store and auth, so no network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks,createPlanner} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial,SequenceEngine}=await import('../dist/tryout-games.js');
const {createBlocks,blocksPlace,blocksResult,placements}=await import('../dist/blocks-core.js');
const {SIM_STEP}=await import('../dist/rng.js');
const {greedyMove,driveSequence}=await import('../tools/sequence-bot.mjs');
const {COMPETITION,dayKey,monthKey,seedFor,cleanName,cleanCode,monthlyStandings,yearlyStandings,pointsForRank,podiumMonths}=await import('../arcade/server/competition.mjs');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');

const SECRET='test-secret';

// --- real replays, played by bots against the shipped engines ---
function ridgeReplay(seed,gates=4){
  const out=stubCallbacks(),e=new RidgeEngine(stubCanvas(),out.cb,{seed,motion:false}),bot=createPlanner(RIDGE,hitsVial);
  e.action();
  while(!e.dead&&!e.ended&&e.gatesPassed<gates){if(bot.decide(e))e.action();for(let t=0;t<bot.every&&!e.dead;t++)e.step(SIM_STEP);}
  e.finish();e.destroy();
  return {replay:out.result.replay,score:out.result.score,seconds:e.ticks*SIM_STEP};
}
function blocksReplay(seed,moves=6){
  const g=createBlocks(seed);
  for(let m=0;m<moves&&!g.ended;m++){const i=g.state.tray.findIndex(p=>p&&placements(g.state.grid,p.shape).length);if(i<0)break;const [r,c]=placements(g.state.grid,g.state.tray[i].shape)[0];blocksPlace(g,i,r,c);}
  const res=blocksResult(g);return {replay:res.replay,score:res.score,seconds:0};
}
function sequenceReplay(seed,level,rulesVersion=2){
  const out=stubCallbacks(),e=new SequenceEngine(stubCanvas(),out.cb,{seed,level,motion:false,rulesVersion});
  driveSequence(e,greedyMove);e.destroy();
  return {replay:out.result.replay,score:out.result.score,won:out.result.won,seconds:e.ticks*SIM_STEP};
}

// --- a tiny world with a controllable clock ---
function world(start='2026-10-14T01:00:00Z'){
  let t=Date.parse(start);const now=()=>new Date(t);
  const store=createMemoryStore({invites:{'PEAK-ONE':1,'TEAM':5},now}),auth=createMemoryAuth();
  const api=createHandlers({store,auth,secret:SECRET,now});
  return {store,auth,api,advance:s=>{t+=s*1000;},now,
    async join(email,name,code='TEAM'){const r=await api.join({body:{email,name,code},origin:'https://example.test'});assert.equal(r.status,200,JSON.stringify(r.body));return auth.tokenFor(email);}};
}

test('Days and months follow Melbourne time',()=>{
  assert.equal(dayKey(new Date('2026-10-13T12:59:00Z')),'2026-10-13','11:59 pm in Melbourne (AEDT, UTC+11)');
  assert.equal(dayKey(new Date('2026-10-13T13:00:00Z')),'2026-10-14','midnight in Melbourne starts the next day');
  assert.equal(dayKey(new Date('2026-06-30T14:00:00Z')),'2026-07-01','winter time is UTC+10');
  assert.equal(monthKey(new Date('2026-10-31T13:30:00Z')),'2026-11');
});

test('Everyone gets the same course per game and day; it changes by day, game and level',()=>{
  const a=seedFor(SECRET,'ridge','2026-10-14');
  assert.equal(a,seedFor(SECRET,'ridge','2026-10-14',1));
  assert.ok(Number.isInteger(a)&&a>=0&&a<2**32);
  for(const other of [seedFor(SECRET,'ridge','2026-10-15'),seedFor(SECRET,'blocks','2026-10-14'),seedFor(SECRET,'ridge','2026-10-14',2),seedFor('other','ridge','2026-10-14')])assert.notEqual(other,a);
  assert.throws(()=>seedFor('', 'ridge','2026-10-14'));
});

test('Names and codes are cleaned',()=>{
  assert.equal(cleanName('  Snow   Pilot <b> '),'Snow Pilot b');
  assert.equal(cleanName('x'),null);
  assert.equal(cleanName('A'.repeat(40)).length,24);
  assert.equal(cleanCode(' peak-one '),'PEAK-ONE');
});

test('Monthly table: best score per game earns rank points, ties share a rank, the three games add up',()=>{
  const at=s=>`2026-10-0${s}T00:00:00Z`;
  const runs=[
    {player_id:'a',game:'ridge',score:30,day:'2026-10-01',updated_at:at(1)},
    {player_id:'a',game:'ridge',score:12,day:'2026-10-02',updated_at:at(2)},
    {player_id:'b',game:'ridge',score:30,day:'2026-10-03',updated_at:at(3)},
    {player_id:'c',game:'ridge',score:25,day:'2026-10-03',updated_at:at(3)},
    {player_id:'b',game:'blocks',score:900,day:'2026-10-03',updated_at:at(3)},
    {player_id:'c',game:'sequence',score:4000,day:'2026-10-04',updated_at:at(4)},
    {player_id:'a',game:'sequence',score:3000,day:'2026-10-04',updated_at:at(4)},
  ];
  const table=monthlyStandings(runs),by=Object.fromEntries(table.map(r=>[r.player_id,r]));
  assert.deepEqual(by.a.games.ridge,{best:30,rank:1,points:100});
  assert.deepEqual(by.b.games.ridge,{best:30,rank:1,points:100},'an equal score shares first place');
  assert.deepEqual(by.c.games.ridge,{best:25,rank:3,points:80},'after a two-way tie the next rank is 3rd');
  assert.equal(by.a.points,100+90);assert.equal(by.b.points,100+100);assert.equal(by.c.points,80+100);
  assert.deepEqual(table.map(r=>r.player_id),['b','a','c'],'ordered by total points');
  assert.deepEqual(table.map(r=>r.rank),[1,2,3]);
  assert.equal(pointsForRank(1),100);assert.equal(pointsForRank(15),5);assert.equal(pointsForRank(40),COMPETITION.minPoints);
});

test('Points ties go to better game ranks, then to whoever got there first',()=>{
  const runs=[
    {player_id:'late',game:'ridge',score:10,day:'2026-10-01',updated_at:'2026-10-05T00:00:00Z'},
    {player_id:'early',game:'blocks',score:10,day:'2026-10-01',updated_at:'2026-10-02T00:00:00Z'},
  ];
  assert.deepEqual(monthlyStandings(runs).map(r=>r.player_id),['early','late']);
});

test('Yearly table adds up monthly rank points',()=>{
  const runs=[
    {player_id:'a',game:'ridge',score:20,day:'2026-09-03',updated_at:'2026-09-03T00:00:00Z'},
    {player_id:'b',game:'ridge',score:10,day:'2026-09-03',updated_at:'2026-09-03T00:00:00Z'},
    {player_id:'b',game:'ridge',score:50,day:'2026-10-03',updated_at:'2026-10-03T00:00:00Z'},
    {player_id:'b',game:'blocks',score:50,day:'2026-10-03',updated_at:'2026-10-03T00:00:00Z'},
  ];
  const table=yearlyStandings(runs);
  assert.deepEqual(table.map(r=>[r.player_id,r.points]),[['b',290],['a',100]]);
});

test('Joining needs a valid invite code; a single-use code works once',async()=>{
  const w=world();
  let r=await w.api.join({body:{email:'a@x.com',name:'Ann',code:'nope'},origin:'o'});assert.equal(r.status,403);
  assert.equal(w.auth.users.size,0,'a bad code creates no account');
  r=await w.api.join({body:{email:'A@X.com ',name:'Ann',code:'peak-one'},origin:'o'});assert.equal(r.status,200);
  assert.equal(w.auth.sent.at(-1).email,'a@x.com');
  r=await w.api.join({body:{email:'b@x.com',name:'Ben',code:'PEAK-ONE'},origin:'o'});assert.equal(r.status,403,'the code is used up');
  r=await w.api.join({body:{email:'a@x.com',name:'Ann',code:'TEAM'},origin:'o'});assert.equal(r.status,200);assert.equal(r.body.existing,true);
  assert.equal(w.store.codes.get('TEAM').uses,0,'an existing account does not use up a code');
  for(const body of [{email:'bad',name:'Ann',code:'TEAM'},{email:'c@x.com',name:'A',code:'TEAM'},{email:'c@x.com',name:'Ann'}])assert.equal((await w.api.join({body,origin:'o'})).status,400);
});

test('Signed-out and unknown requests are refused',async()=>{
  const w=world();
  for(const name of ['me','start','finish','leaderboard','profile'])assert.equal((await w.api[name]({token:null,body:{},query:{}})).status,401);
  const t=await w.join('a@x.com','Ann');
  assert.equal((await w.api.start({token:t,body:{game:'orbit'}})).status,400);
  assert.equal((await w.api.finish({token:t,body:{runId:'missing'}})).status,404);
});

test('Three plays per game per Melbourne day, then none until tomorrow',async()=>{
  const w=world('2026-10-14T01:00:00Z'),t=await w.join('a@x.com','Ann');
  assert.deepEqual((await w.api.me({token:t})).body.plays,{blocks:3,sequence:3,ridge:3});
  for(let i=0;i<3;i++)assert.equal((await w.api.start({token:t,body:{game:'ridge'}})).status,200);
  const r=await w.api.start({token:t,body:{game:'ridge'}});
  assert.equal(r.status,409);assert.equal(r.body.plays.ridge,0);assert.equal(r.body.plays.blocks,3);
  w.advance(12*3600);
  assert.equal((await w.api.me({token:t})).body.plays.ridge,3,'midnight in Melbourne refills plays');
});

test('A Ridge Run score counts only after the server replays it',async()=>{
  const w=world(),t=await w.join('a@x.com','Ann');
  const s=await w.api.start({token:t,body:{game:'ridge'}});
  assert.equal(s.body.seed,seedFor(SECRET,'ridge',dayKey(w.now())),'the run gets today\'s shared course');
  const run=ridgeReplay(s.body.seed);assert.ok(run.score>0);
  w.advance(run.seconds+2);
  const f=await w.api.finish({token:t,body:{runId:s.body.runId,replay:run.replay,claimed:run.score}});
  assert.equal(f.status,200,JSON.stringify(f.body));assert.equal(f.body.score,run.score);assert.equal(f.body.done,true);
  assert.equal((await w.api.finish({token:t,body:{runId:s.body.runId,replay:run.replay}})).status,200,'identical retries return the verified result without counting it twice');
  const stored=w.store.runs.get(s.body.runId);assert.equal(stored.status,'closed');assert.equal(stored.flagged,false);
});

test('Cheating attempts are rejected and the play is spent',async()=>{
  const w=world(),t=await w.join('a@x.com','Ann');
  // A run recorded on a different course.
  let s=await w.api.start({token:t,body:{game:'ridge'}});
  let run=ridgeReplay(s.body.seed+1);w.advance(run.seconds+2);
  let f=await w.api.finish({token:t,body:{runId:s.body.runId,replay:run.replay}});
  assert.equal(f.status,422);assert.match(f.body.reason,/different course/);
  assert.equal(w.store.runs.get(s.body.runId).status,'rejected');
  // A run submitted faster than it could have been played (a bot playing ahead of real time).
  s=await w.api.start({token:t,body:{game:'ridge'}});run=ridgeReplay(s.body.seed,25);assert.ok(run.seconds>20);w.advance(1);
  f=await w.api.finish({token:t,body:{runId:s.body.runId,replay:run.replay}});
  assert.equal(f.status,422);assert.match(f.body.reason,/real time/);
  // A doctored Blocks log and a claimed score that doesn't match get caught.
  s=await w.api.start({token:t,body:{game:'blocks'}});
  const b=blocksReplay(s.body.seed);b.replay.log.push(['p',0,99,99]);
  f=await w.api.finish({token:t,body:{runId:s.body.runId,replay:b.replay}});
  assert.equal(f.status,422);
  s=await w.api.start({token:t,body:{game:'blocks'}});
  const b2=blocksReplay(s.body.seed);
  f=await w.api.finish({token:t,body:{runId:s.body.runId,replay:b2.replay,claimed:b2.score*10}});
  assert.equal(f.status,200);assert.equal(f.body.score,b2.score,'the stored score is the replayed one');
  assert.equal(w.store.runs.get(s.body.runId).flagged,true,'a false claim marks the run for review');
  // Someone else's run.
  const t2=await w.join('b@x.com','Ben');
  s=await w.api.start({token:t,body:{game:'sequence'}});
  assert.equal((await w.api.finish({token:t2,body:{runId:s.body.runId,replay:{}}})).status,404);
});

test('Sequence runs go level by level; each cleared level unlocks the next board',async()=>{
  const w=world(),t=await w.join('a@x.com','Ann');
  const s=await w.api.start({token:t,body:{game:'sequence'}});
  const l1=sequenceReplay(s.body.seed,1);assert.equal(l1.won,true,'the greedy bot clears level 1');
  w.advance(l1.seconds+1);
  let f=await w.api.finish({token:t,body:{runId:s.body.runId,replay:l1.replay}});
  assert.equal(f.status,200);assert.equal(f.body.done,false);assert.equal(f.body.nextLevel,2);
  const day=dayKey(w.now());assert.equal(f.body.nextSeed,seedFor(SECRET,'sequence-v2',day,2));
  // Replaying level 1's board as level 2 doesn't work.
  const wrong=sequenceReplay(s.body.seed,2);w.advance(wrong.seconds+1);
  const bad=await w.api.finish({token:t,body:{runId:s.body.runId,replay:wrong.replay}});
  assert.equal(bad.status,422);
  // A fresh run: clear level 1, then lose level 2 on purpose by finishing at once; the total is both levels.
  const s2=await w.api.start({token:t,body:{game:'sequence'}});
  const a=sequenceReplay(s2.body.seed,1);w.advance(a.seconds+1);
  f=await w.api.finish({token:t,body:{runId:s2.body.runId,replay:a.replay}});
  const out=stubCallbacks(),e=new SequenceEngine(stubCanvas(),out.cb,{seed:f.body.nextSeed,level:2,motion:false});
  for(let i=0;i<60;i++)e.step(SIM_STEP);e.finish();e.destroy();
  w.advance(2);
  f=await w.api.finish({token:t,body:{runId:s2.body.runId,replay:out.result.replay}});
  assert.equal(f.status,200);assert.equal(f.body.done,true);assert.equal(f.body.score,a.score+out.result.score);
});

test('Starting a new run closes an unfinished one, keeping any levels already verified',async()=>{
  const w=world(),t=await w.join('a@x.com','Ann');
  const s=await w.api.start({token:t,body:{game:'sequence'}});
  const l1=sequenceReplay(s.body.seed,1);w.advance(l1.seconds+1);
  await w.api.finish({token:t,body:{runId:s.body.runId,replay:l1.replay}});
  await w.api.start({token:t,body:{game:'sequence'}});
  const old=w.store.runs.get(s.body.runId);assert.equal(old.status,'closed');assert.equal(old.score,l1.score);
});

test('Leaderboard shows verified scores as rank points, with your own row',async()=>{
  const w=world(),ann=await w.join('a@x.com','Ann'),ben=await w.join('b@x.com','Ben');
  for(const [token,gates] of [[ann,6],[ben,3]]){
    const s=await w.api.start({token,body:{game:'ridge'}});const r=ridgeReplay(s.body.seed,gates);w.advance(r.seconds+2);
    assert.equal((await w.api.finish({token,body:{runId:s.body.runId,replay:r.replay}})).status,200);
  }
  const s=await w.api.start({token:ben,body:{game:'blocks'}});const b=blocksReplay(s.body.seed);
  await w.api.finish({token:ben,body:{runId:s.body.runId,replay:b.replay}});
  assert.equal((await w.api.profile({token:ann,body:{name:'Ann Peak',bottle:'golden-peak'}})).status,403);
  assert.equal((await w.api.profile({token:ann,body:{name:'Ann Peak'}})).status,200);
  const lb=(await w.api.leaderboard({token:ann,query:{period:'monthly'}})).body;
  assert.equal(lb.key,monthKey(w.now()));assert.equal(lb.players,2);
  assert.deepEqual(lb.top.map(r=>[r.rank,r.name,r.points]),[[1,'Ben',190],[2,'Ann Peak',100]]);
  assert.equal(lb.top[1].bottle,'ph-original');assert.equal(lb.me.you,true);assert.equal(lb.me.rank,2);
  assert.equal(lb.top[0].games.blocks.points,100);
  const year=(await w.api.leaderboard({token:ann,query:{period:'yearly'}})).body;
  assert.equal(year.period,'yearly');assert.equal(year.top[0].points,190);
  assert.equal((await w.api.profile({token:ann,body:{bottle:'gold'}})).status,400);
});

test('Each game has its own board of best scores, monthly and yearly',async()=>{
  const w=world(),ann=await w.join('a@x.com','Ann'),ben=await w.join('b@x.com','Ben');
  const scores={};
  for(const [token,gates] of [[ann,6],[ben,3]]){
    const s=await w.api.start({token,body:{game:'ridge'}});const r=ridgeReplay(s.body.seed,gates);w.advance(r.seconds+2);
    scores[token]=(await w.api.finish({token,body:{runId:s.body.runId,replay:r.replay}})).body.score;
  }
  const s=await w.api.start({token:ben,body:{game:'blocks'}});const b=blocksReplay(s.body.seed);
  await w.api.finish({token:ben,body:{runId:s.body.runId,replay:b.replay}});
  const ridge=(await w.api.leaderboard({token:ben,query:{period:'monthly',game:'ridge'}})).body;
  assert.equal(ridge.game,'ridge');assert.equal(ridge.players,2);
  assert.deepEqual(ridge.top.map(r=>[r.rank,r.name,r.points]),[[1,'Ann',scores[ann]],[2,'Ben',scores[ben]]]);
  assert.equal(ridge.me.rank,2);
  const blocks=(await w.api.leaderboard({token:ann,query:{period:'yearly',game:'blocks'}})).body;
  assert.deepEqual(blocks.top.map(r=>r.name),['Ben']);assert.equal(blocks.me,null);
  const unknown=(await w.api.leaderboard({token:ann,query:{period:'monthly',game:'tower'}})).body;
  assert.equal(unknown.game,null);
});

test('Lifetime points from finished games unlock bottles',async()=>{
  const w=world(),ann=await w.join('a@x.com','Ann');
  assert.equal((await w.api.me({token:ann})).body.player.points,0);
  assert.equal((await w.api.profile({token:ann,body:{bottle:'sky-molecule'}})).status,403);
  const {store}=w,id=[...store.players.keys()][0];
  for(let i=0;i<2;i++)store.runs.set(`seed-${i}`,{id:`seed-${i}`,player_id:id,game:'ridge',day:dayKey(w.now()),score:2500,status:'closed',segments:1,updated_at:w.now().toISOString()});
  const me=(await w.api.me({token:ann})).body.player;
  assert.equal(me.points,500);assert.equal(me.podium,false);
  assert.equal((await w.api.profile({token:ann,body:{bottle:'sky-molecule'}})).status,200);
  assert.equal((await w.api.profile({token:ann,body:{bottle:'ice-flow'}})).status,403);
});

test('A top-three monthly finish is found for Golden Peak',()=>{
  const run=(player_id,score,day)=>({player_id,game:'ridge',score,day,updated_at:`${day}T01:00:00Z`});
  const runs=[run('a',90,'2026-08-03'),run('b',80,'2026-08-04'),run('c',70,'2026-08-05'),run('d',60,'2026-08-06'),run('d',99,'2026-09-02')];
  assert.deepEqual(podiumMonths(runs,'c'),['2026-08']);
  assert.deepEqual(podiumMonths(runs,'d'),['2026-09']);
  assert.deepEqual(podiumMonths(runs,'e'),[]);
});

test('A finished run reports its place on this month\'s board, a new best, and plays left',async()=>{
  const w=world(),ann=await w.join('a@x.com','Ann'),ben=await w.join('b@x.com','Ben');
  const play=async(token,gates)=>{const s=await w.api.start({token,body:{game:'ridge'}});const r=ridgeReplay(s.body.seed,gates);w.advance(r.seconds+2);return (await w.api.finish({token,body:{runId:s.body.runId,replay:r.replay}})).body;};
  let f=await play(ben,6);
  assert.equal(f.board.rank,1);assert.equal(f.board.players,1);assert.equal(f.board.newBest,true);assert.equal(f.board.previousBest,0);assert.equal(f.plays.ridge,2);
  f=await play(ann,3);
  assert.equal(f.board.rank,2);assert.equal(f.board.players,2);assert.equal(f.board.newBest,true);
  f=await play(ann,2);
  assert.equal(f.board.newBest,false,'a lower score is not a new best');assert.equal(f.board.rank,2,'rank uses the best score');assert.ok(f.board.best>f.score);assert.equal(f.plays.ridge,1);
  f=await play(ann,8);
  assert.equal(f.board.rank,1);assert.equal(f.board.newBest,true);assert.equal(f.plays.ridge,0);
});


test('Retrying a cleared Sequence level cannot reject the run or add its score twice',async()=>{
 const w=world(),token=await w.join('retry@x.com','Retry');
 const start=(await w.api.start({token,body:{game:'sequence'}})).body;
 const r=sequenceReplay(start.seed,1);assert.ok(r.won);w.advance(r.seconds+1);
 const body={runId:start.runId,replay:r.replay,claimed:r.score};
 const first=await w.api.finish({token,body}),second=await w.api.finish({token,body});
 assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(second.body.score,r.score);assert.equal(second.body.nextLevel,2);
 assert.equal(w.store.runs.get(start.runId).segments,1);assert.equal(w.store.runs.get(start.runId).status,'open');
});
test('Concurrent identical finish requests count once and both receive verification',async()=>{
 const w=world(),token=await w.join('double@x.com','Double');
 const start=(await w.api.start({token,body:{game:'blocks'}})).body,r=blocksReplay(start.seed);
 const replies=await Promise.all([1,2].map(()=>w.api.finish({token,body:{runId:start.runId,replay:r.replay}})));
 assert.deepEqual(replies.map(r=>r.status),[200,200]);assert.equal(w.store.runs.get(start.runId).score,r.score);assert.equal(w.store.runs.get(start.runId).segments,1);
});

test('A lost start response can be retried after the last play without spending another play',async()=>{
 const w=world(),token=await w.join('start-retry@x.com','Start Retry');
 for(let i=0;i<2;i++)await w.api.start({token,body:{game:'blocks'}});
 const requestId='4f372615-a2cd-46e2-93cc-c91e113be4b8',body={game:'blocks',requestId};
 const [a,b]=await Promise.all([w.api.start({token,body}),w.api.start({token,body})]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.runId,b.body.runId);assert.equal(b.body.plays.blocks,0);assert.equal(w.store.runs.size,3);
 const r=blocksReplay(a.body.seed);await w.api.finish({token,body:{runId:a.body.runId,replay:r.replay}});
 assert.equal((await w.api.start({token,body})).status,409,'a completed run cannot be reopened');
 assert.equal((await w.api.start({token,body:{game:'blocks',requestId:'invalid'}})).status,400);
});


test('Retry comparison tolerates Postgres jsonb object key order',async()=>{
 const w=world(),token=await w.join('jsonb-retry@x.com','JSON Retry');
 const start=(await w.api.start({token,body:{game:'blocks'}})).body,r=blocksReplay(start.seed);
 const body={runId:start.runId,replay:r.replay};assert.equal((await w.api.finish({token,body})).status,200);
 const stored=w.store.runs.get(start.runId),rep=stored.replays[0];stored.replays=[Object.fromEntries(Object.entries(rep).reverse())];
 assert.equal((await w.api.finish({token,body})).status,200,'jsonb reorders object keys without changing the replay');assert.equal(stored.segments,1);
});


test('New Sequence competition runs cannot downgrade to v1, while pre-upgrade runs keep their course',async()=>{
 const w=world(),token=await w.join('sequence-version@x.com','Version Check');
 const start=await w.api.start({token,body:{game:'sequence'}});assert.equal(start.body.rulesVersion,2);
 const oldReplay=sequenceReplay(start.body.seed,1,1);w.advance(oldReplay.seconds+1);
 const downgrade=await w.api.finish({token,body:{runId:start.body.runId,replay:oldReplay.replay}});assert.equal(downgrade.status,422);assert.match(downgrade.body.reason,/different level rules/);
 const player=await w.auth.userFromToken(token),day=dayKey(w.now()),seed=seedFor(SECRET,'sequence',day,1);
 const legacy=await w.store.startRun({playerId:player.id,game:'sequence',day,seed,limit:3});
 const replay=sequenceReplay(seed,1,1);assert.ok(replay.won);w.advance(replay.seconds+1);
 const finish=await w.api.finish({token,body:{runId:legacy.id,replay:replay.replay}});assert.equal(finish.status,200);assert.equal(finish.body.done,false);assert.equal(finish.body.nextSeed,seedFor(SECRET,'sequence',day,2));
});
