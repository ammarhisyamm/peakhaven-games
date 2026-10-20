// The flags that put a run in "Runs to review", and the two admin panels that read them.
//
// The contract every one of these tests is really checking is the same: a flag never rejects a run, never
// changes its score and never moves it on a board. It writes a sentence. So each flag below is asserted
// twice over — that it fired, and that the run came through it with a 200 and the score its replay
// produced.
//
// Uses the in-memory store and auth, so no network and no database are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks,createPlanner} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial,SequenceEngine}=await import('../dist/tryout-games.js');
const {createBlocks,blocksPlace,blocksResult,placements}=await import('../dist/blocks-core.js');
const {SIM_STEP}=await import('../dist/rng.js');
const {greedyMove,driveSequence}=await import('../tools/sequence-bot.mjs');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');
const {MIN_BLOCKS_MOVE_SECONDS}=await import('../arcade/server/verify.mjs');
const flags=await import('../arcade/server/flags.mjs');
const {normaliseEmail,duplicateGroups,totalsIndex}=await import('../arcade/server/duplicates.mjs');
const {reasonLine,reasonsMarkup}=await import('../arcade/ui/admin-review.js');
const {checklistMarkup,winnerPanels}=await import('../arcade/ui/admin-winners.js');
const {duplicatePanel,spanText}=await import('../arcade/ui/admin-duplicates.js');

const SECRET='test-secret',ADMIN='boss@peak.test';
const GAME_LABELS=[{game:'blocks',label:'Peak Blocks'},{game:'sequence',label:'Sequence'},{game:'ridge',label:'Ridge Run'}];

function world(start='2026-10-14T01:00:00Z',{flagReasons=true}={}){
  let t=Date.parse(start);const now=()=>new Date(t);
  const store=createMemoryStore({invites:{TEAM:20,OTHER:20},now,flagReasons}),auth=createMemoryAuth();
  const api=createHandlers({store,auth,secret:SECRET,now,admins:[ADMIN]});
  let n=0;
  return {store,auth,api,now,advance:s=>{t+=s*1000;},
    async join(email,name,code='TEAM'){
      const r=await api.join({body:{email,name,code},origin:'https://example.test'});
      assert.equal(r.status,200,JSON.stringify(r.body));
      return {token:auth.tokenFor(email),id:[...auth.users.values()].find(u=>u.email===email).id,email,name};
    },
    // A finished run straight into the store, for the history the outlier flag reads and for the panels.
    score(player,game,score,{day='2026-10-10',flagged=false,segments=1}={}){
      const id=`run-${++n}`;
      store.runs.set(id,{id,player_id:player.id,game,day,score,status:'closed',segments,flagged,
        reject_reason:null,paid:false,replays:[],flag_reasons:[],
        started_at:`${day}T0${n%9}:00:00Z`,updated_at:`${day}T0${n%9}:00:00Z`,finished_at:`${day}T0${n%9}:00:00Z`});
      return id;
    },
    async adminToken(){await this.join(ADMIN,'Boss');return auth.tokenFor(ADMIN);},
    view(token,query){return api.admin({token,query,method:'GET'});},
    act(token,body){return api.admin({token,body,method:'POST'});}};
}

function blocksReplay(seed,moves=6){
  const g=createBlocks(seed);
  for(let m=0;m<moves&&!g.ended;m++){
    const i=g.state.tray.findIndex(p=>p&&placements(g.state.grid,p.shape).length);
    if(i<0)break;
    const [r,c]=placements(g.state.grid,g.state.tray[i].shape)[0];
    blocksPlace(g,i,r,c);
  }
  const res=blocksResult(g);
  return {replay:res.replay,score:res.score,moves:res.moves,seconds:res.moves*MIN_BLOCKS_MOVE_SECONDS};
}
function ridgeReplay(seed,gates=4){
  const out=stubCallbacks(),e=new RidgeEngine(stubCanvas(),out.cb,{seed,motion:false}),bot=createPlanner(RIDGE,hitsVial);
  e.action();
  while(!e.dead&&!e.ended&&e.gatesPassed<gates){if(bot.decide(e))e.action();for(let i=0;i<bot.every&&!e.dead;i++)e.step(SIM_STEP);}
  e.finish();e.destroy();
  return {replay:out.result.replay,score:out.result.score,seconds:e.ticks*SIM_STEP};
}
function sequenceReplay(seed,level,rulesVersion=4){
  const out=stubCallbacks(),e=new SequenceEngine(stubCanvas(),out.cb,{seed,level,motion:false,rulesVersion});
  driveSequence(e,greedyMove);
  if(!e.ended)e.finish();
  const ticks=e.ticks;e.destroy();
  return {replay:out.result.replay,score:out.result.score,won:out.result.won,seconds:ticks*SIM_STEP};
}

// ---------------------------------------------------------------- the rules on their own

test('A median gap needs enough inputs to mean anything, and refuses a log that goes backwards',()=>{
  assert.equal(flags.medianGapSeconds([]),null,'nothing at all says nothing');
  assert.equal(flags.medianGapSeconds([0,1,2]),null,`under ${flags.MIN_INPUTS_FOR_TIMING} inputs says nothing`);
  const even=Array.from({length:9},(_,i)=>i*10);
  assert.equal(flags.medianGapSeconds(even),10*SIM_STEP,'a steady log is its own gap');
  // One huge pause between otherwise quick inputs must not drag the median up: that is the point of a
  // median rather than a mean.
  const paused=[0,2,4,6,8,10,12,14,100000];
  assert.equal(flags.medianGapSeconds(paused),2*SIM_STEP);
  assert.equal(flags.medianGapSeconds([0,10,5,20,30,40,50,60,70]),null,'a log that goes backwards is not measured');
  assert.equal(flags.medianGapSeconds([0,10,'x',20,30,40,50,60,70]),null,'nor is one with a non-number in it');
});

test('A duration reads the way a person would say it',()=>{
  assert.equal(flags.formatDuration(0),'0 s');
  assert.equal(flags.formatDuration(38),'38 s');
  assert.equal(flags.formatDuration(90),'2 min');
  assert.equal(flags.formatDuration(1860),'31 min');
  assert.equal(flags.formatDuration(3600),'1 h');
  assert.equal(flags.formatDuration(8040),'2 h 14 min','the shape the task asked for');
  assert.equal(flags.formatGap(.118),'118 ms');
  assert.equal(flags.formatGap(1.44),'1.4 s');
});

test('Each flag fires on its own measurement and stays quiet otherwise',()=>{
  const base={game:'blocks',claimed:100,verified:100,openSeconds:60,history:[],moves:0,done:true};
  assert.deepEqual(flags.runFlags(base),[],'an unremarkable run has nothing said about it');

  const mismatch=flags.runFlags({...base,claimed:12400,verified:9850});
  assert.deepEqual(mismatch.map(r=>r.code),['claim-mismatch']);
  assert.equal(mismatch[0].text,'Claimed 12,400 against a verified 9,850.');

  const long=flags.runFlags({...base,openSeconds:8040});
  assert.deepEqual(long.map(r=>r.code),['long-open']);
  assert.equal(long[0].text,'Submitted 2 h 14 min after starting.','names the time, as asked');
  assert.deepEqual(flags.runFlags({...base,openSeconds:flags.LONG_RUN_SECONDS}),[],'exactly on the threshold is not over it');
  assert.deepEqual(flags.runFlags({...base,openSeconds:8040,done:false}),[],
    'a Sequence run still being played has not taken too long yet');

  const history=[9850,8000,7000,6000,5000];
  // Claiming what it verified, so the only thing under test is the outlier rule: the shared base claims
  // 100, and a run that verified anything else would trip claim-mismatch as well.
  const outlier=flags.runFlags({...base,claimed:48200,verified:48200,history});
  assert.deepEqual(outlier.map(r=>r.code),['score-outlier']);
  assert.equal(outlier[0].text,
    'Scored 48,200, more than 3x their previous best of 9,850 over 5 earlier runs.','names both numbers');
  assert.deepEqual(flags.runFlags({...base,claimed:48200,verified:48200,history:history.slice(0,4)}),[],
    `under ${flags.OUTLIER_MIN_RUNS} earlier runs is not enough history to judge`);
  assert.deepEqual(flags.runFlags({...base,claimed:29550,verified:29550,history}),[],'exactly 3x is not more than 3x');
  assert.deepEqual(flags.runFlags({...base,claimed:5000,verified:5000,history:[0,0,0,0,0]}),[],
    'a first real score against a best of nothing is not an outlier');

  const fastSeq=flags.runFlags({...base,game:'sequence',moves:40,medianGapSeconds:.118});
  assert.deepEqual(fastSeq.map(r=>r.code),['fast-moves']);
  assert.equal(fastSeq[0].text,'Moves 118 ms apart on average, over 40 moves.','names the measured number');
  assert.deepEqual(flags.runFlags({...base,game:'sequence',moves:40,medianGapSeconds:.6}),[],
    'an ordinary pace says nothing');
  assert.deepEqual(flags.runFlags({...base,game:'sequence',moves:4,medianGapSeconds:.01}),[],
    'too few moves to judge, however fast they were');

  const fastBlocks=flags.runFlags({...base,moves:120,wallSecondsPerMove:.31});
  assert.deepEqual(fastBlocks.map(r=>r.code),['fast-moves']);
  assert.equal(fastBlocks[0].text,'310 ms a placement over 120 placements.');
  assert.deepEqual(flags.runFlags({...base,moves:120,wallSecondsPerMove:.9}),[],'a human pace says nothing');
  assert.deepEqual(flags.runFlags({...base,game:'sequence',moves:120,wallSecondsPerMove:.31}),[],
    'the wall-clock pace is a Peak Blocks measure only');
});

test('One run can be caught by several checks at once',()=>{
  const caught=flags.runFlags({game:'sequence',claimed:99999,verified:48200,openSeconds:8040,
    history:[9850,8000,7000,6000,5000],moves:40,medianGapSeconds:.1,done:true});
  assert.deepEqual(caught.map(r=>r.code).sort(),['claim-mismatch','fast-moves','long-open','score-outlier']);
});

test('A Sequence run collects its reasons level by level, keeping the newest of each',()=>{
  const first=[{code:'fast-moves',text:'fast, level one'}];
  const second=[{code:'fast-moves',text:'fast, level two'},{code:'long-open',text:'long'}];
  const merged=flags.mergeReasons(first,second);
  assert.deepEqual(merged.map(r=>r.code),['fast-moves','long-open'],'one of each, in the order they arrived');
  assert.equal(merged[0].text,'fast, level two','measured over more of the run, so it wins');
  assert.deepEqual(flags.mergeReasons(null,null),[]);
  assert.deepEqual(flags.mergeReasons([{nope:1},null],[]),[],'a row with no code is not a reason');
});

test('A stored run can be described from its replays without replaying it',()=>{
  const blocks=blocksReplay(99,10);
  const summary=flags.summariseReplays('blocks',[blocks.replay]);
  assert.equal(summary.moves,blocks.replay.log.length);
  assert.equal(summary.gameSeconds,null,'Peak Blocks has no clock in its log, which is said rather than zeroed');
  const ridge=ridgeReplay(1234,4);
  const r=flags.summariseReplays('ridge',[ridge.replay]);
  assert.equal(r.moves,ridge.replay.taps.length);
  assert.ok(r.gameSeconds>0,'Ridge does carry a clock');
  const one=sequenceReplay(4321,1),two=sequenceReplay(4321,1);
  const s=flags.summariseReplays('sequence',[one.replay,two.replay]);
  assert.equal(s.segments,2,'a Sequence run is a replay per level');
  assert.equal(s.moves,one.replay.moves.length+two.replay.moves.length,'and its moves add up');
});

// ---------------------------------------------------------------- the flags through the API

test('A run finished long after it started is flagged, and still counts for every point it scored',async()=>{
  const w=world(),player=await w.join('slow@peak.test','Slow');
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed);
  w.advance(45*60);
  const f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}});
  assert.equal(f.status,200,'a flag never refuses the run');
  assert.equal(f.body.score,b.score,'nor changes its score');
  const run=w.store.runs.get(started.body.runId);
  assert.equal(run.status,'closed','nor rejects it');
  assert.equal(run.flagged,true);
  assert.deepEqual(run.flag_reasons.map(r=>r.code),['long-open']);
  assert.match(run.flag_reasons[0].text,/^Submitted 45 min after starting\.$/);
  // And it is on the boards, which is the half of this that matters most.
  const board=(await w.api.leaderboard({token:player.token,query:{period:'monthly',game:'blocks'}})).body;
  assert.equal(board.me.points,b.score,'a flagged run still ranks');
});

test('A score far above the player&rsquo;s own best is flagged once there is enough history',async()=>{
  const w=world(),player=await w.join('spike@peak.test','Spike');
  // Four earlier runs is not enough history for a best to mean anything.
  for(const score of [40,38,36,34])w.score(player,'blocks',score);
  let started=await w.api.start({token:player.token,body:{game:'blocks'}});
  let b=blocksReplay(started.body.seed,30);
  w.advance(b.seconds+60);
  let f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}});
  assert.equal(f.status,200);
  assert.ok(b.score>40*3,`the run is well over three times that best (${b.score})`);
  assert.equal(w.store.runs.get(started.body.runId).flag_reasons.some(r=>r.code==='score-outlier'),false,
    'four earlier runs is under the threshold, so nothing is said');

  // A fifth makes the history count, and the same kind of run is then flagged.
  const w2=world(),p2=await w2.join('spike2@peak.test','Spike');
  for(const score of [40,38,36,34,32])w2.score(p2,'blocks',score);
  started=await w2.api.start({token:p2.token,body:{game:'blocks'}});
  b=blocksReplay(started.body.seed,30);
  w2.advance(b.seconds+60);
  f=await w2.api.finish({token:p2.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}});
  assert.equal(f.status,200,'still a 200');
  assert.equal(f.body.score,b.score,'still the verified score');
  const reason=w2.store.runs.get(started.body.runId).flag_reasons.find(r=>r.code==='score-outlier');
  assert.ok(reason,'now there is history to judge against');
  assert.equal(reason.previousBest,40);
  assert.equal(reason.priorRuns,5);
  assert.match(reason.text,/more than 3x their previous best of 40 over 5 earlier runs/);
  // A run in another game has its own history and is untouched by this one.
  assert.deepEqual(await w2.store.playerGameScores(p2.id,'ridge'),[]);
});

test('A Sequence run moving faster than the engine allows is refused outright, not flagged',async()=>{
  // Worth recording, because it means the Sequence half of the near-instant-moves flag cannot currently
  // fire and the reason is a good one. Two things stand in the way of a fast Sequence replay, and they
  // are both upstream of any flag:
  //
  //   the engine refuses a move while a swap or a fall is still animating, so it logs nothing; and
  //   replaySequence counts an unlogged move as an unused input, which rejects the whole run.
  //
  // So a bot playing Sequence at speed does not reach the review page at all — it is turned away at
  // verification, which is a stronger outcome than a flag. Measured against the shipped engine, a replay
  // played as fast as it permits still medians 575ms between moves, well above the 150ms threshold, so
  // nothing legal is under it. The rule stays in flags.mjs (it is covered directly above, costs nothing,
  // and becomes live the moment that gating changes), but it is not reachable from here today.
  const w=world(),player=await w.join('fast@peak.test','Fast');
  const started=await w.api.start({token:player.token,body:{game:'sequence'}});
  const l1=sequenceReplay(started.body.seed,1);
  assert.ok(l1.replay.moves.length>=flags.MIN_INPUTS_FOR_TIMING,'enough moves for a median to mean something');
  // The bot's own legal moves, with the clock squeezed to 6 ticks (100ms) apart.
  const quick={...l1.replay,moves:l1.replay.moves.map((m,i)=>[i*6,m[1],m[2]]),endTick:l1.replay.moves.length*6+1};
  const gap=flags.medianGapSeconds(quick.moves.map(m=>m[0]));
  assert.ok(gap<flags.FAST_SEQUENCE_GAP_SECONDS,'this pace is under the threshold the flag would read');
  w.advance(l1.seconds+60);
  const f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:quick,claimed:l1.score}});
  assert.equal(f.status,422,'refused, because the engine would not have accepted those moves');
  assert.match(f.body.reason,/unused or invalid inputs/);
  assert.equal(w.store.runs.get(started.body.runId).status,'rejected');
});

test('A Peak Blocks run placed quicker than a person places is flagged above the floor it is refused below',async()=>{
  const w=world(),player=await w.join('blocks@peak.test','Blocks');
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed,30);
  // 320ms a placement: over the 250ms the run would be refused below, under the 400ms it is flagged below.
  const pace=.32;
  assert.ok(pace>MIN_BLOCKS_MOVE_SECONDS&&pace<flags.FAST_BLOCKS_MOVE_SECONDS,'in the band between the two');
  w.advance(b.moves*pace);
  const f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}});
  assert.equal(f.status,200,'flagged, not refused');
  assert.equal(f.body.score,b.score);
  const reason=w.store.runs.get(started.body.runId).flag_reasons.find(r=>r.code==='fast-moves');
  assert.ok(reason,'the pace is remarked on');
  assert.equal(reason.moves,b.moves);
  assert.match(reason.text,/a placement over \d+ placements\./);
});

test('An honest run is flagged for nothing at all',async()=>{
  const w=world(),player=await w.join('honest@peak.test','Honest');
  for(const game of ['blocks','ridge','sequence']){
    const started=await w.api.start({token:player.token,body:{game}});
    const played=game==='blocks'?blocksReplay(started.body.seed,30)
      :game==='ridge'?ridgeReplay(started.body.seed,6)
      :sequenceReplay(started.body.seed,1);
    // A human pace: well over the floor, well under half an hour.
    w.advance(game==='blocks'?played.moves*1.1:played.seconds+90);
    const f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:played.replay,claimed:played.score}});
    assert.equal(f.status,200,`${game}: ${JSON.stringify(f.body)}`);
    const run=w.store.runs.get(started.body.runId);
    assert.deepEqual(run.flag_reasons,[],`${game} is flagged for nothing`);
    assert.equal(run.flagged,false);
  }
});

test('Without flag-reasons.sql a run is still flagged, and the page says what it always said',async()=>{
  const w=world('2026-10-14T01:00:00Z',{flagReasons:false});
  const token=await w.adminToken();
  const player=await w.join('legacy@peak.test','Legacy');
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed);
  w.advance(45*60);
  const f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}});
  assert.equal(f.status,200,'finishing still works without the column');
  const run=w.store.runs.get(started.body.runId);
  assert.equal(run.flagged,true,'and the run is still flagged');
  assert.deepEqual(run.flag_reasons,[],'but nothing was written where there is nowhere to write it');
  const view=await w.view(token,{month:'2026-10'});
  assert.equal(view.body.review.reasons,false,'the page knows the migration has not run');
  const listed=view.body.review.runs.find(r=>r.id===started.body.runId);
  assert.deepEqual(listed.reasons,[{code:'legacy',text:flags.LEGACY_FLAG_REASON}]);
  assert.match(reasonLine(listed),/did not match/i,'so it falls back to the one sentence');
});

test('The review page lists every reason on a run, not just the first',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('both@peak.test','Both');
  for(const score of [40,38,36,34,32])w.score(player,'blocks',score);
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed,30);
  w.advance(45*60);
  const f=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score+500}});
  assert.equal(f.status,200);
  const view=await w.view(token,{month:'2026-10'});
  const listed=view.body.review.runs.find(r=>r.id===started.body.runId);
  const codes=listed.reasons.map(r=>r.code).sort();
  assert.deepEqual(codes,['claim-mismatch','long-open','score-outlier'],'three checks caught this one run');
  const markup=reasonsMarkup(listed);
  assert.match(markup,/<ul class="admin-reasons">/,'several reasons read as a list');
  for(const code of codes)assert.match(markup,new RegExp(`data-flag="${code}"`));
  assert.equal(listed.counts,true,'and it still counts');
});

// ---------------------------------------------------------------- possible duplicates

test('An address is normalised to the mailbox it actually reaches',()=>{
  assert.equal(normaliseEmail('Billy+arcade@Gmail.com'),'billy@gmail.com');
  assert.equal(normaliseEmail('b.i.l.l.y@gmail.com'),'billy@gmail.com','Gmail ignores dots');
  assert.equal(normaliseEmail('b.i.l.l.y@googlemail.com'),'billy@googlemail.com');
  assert.equal(normaliseEmail('b.illy@outlook.com'),'b.illy@outlook.com','other hosts do not');
  assert.equal(normaliseEmail('billy+a+b@gmail.com'),'billy@gmail.com');
  assert.equal(normaliseEmail('+leading@gmail.com'),'+leading@gmail.com','a local part that is only a tag is left alone');
  assert.equal(normaliseEmail('  MIXED@Example.COM '),'mixed@example.com');
  assert.equal(normaliseEmail('not-an-address'),'not-an-address');
  assert.equal(normaliseEmail(null),'');
});

test('Accounts on one invite code minutes apart are grouped, and a chain stays one group',()=>{
  const at=(h,m)=>`2026-10-10T0${h}:${String(m).padStart(2,'0')}:00Z`;
  const players=[
    {id:'a',name:'A',invite_code:'TEAM',created_at:at(1,0)},
    {id:'b',name:'B',invite_code:'TEAM',created_at:at(1,2)},
    // Twenty minutes past B, so chained into the same sitting even though it is more than half an hour
    // after A: four accounts made ten minutes apart are one cluster, not two.
    {id:'c',name:'C',invite_code:'TEAM',created_at:at(1,22)},
    // Hours later on the same code: its own thing, and alone, so not a group at all.
    {id:'d',name:'D',invite_code:'TEAM',created_at:at(5,0)},
    {id:'e',name:'E',invite_code:'OTHER',created_at:at(1,1)},
  ];
  const groups=duplicateGroups({players,emails:new Map(),totals:new Map()});
  assert.equal(groups.length,1,'one cluster, and the lone signup is not one');
  assert.equal(groups[0].kind,'invite-code');
  assert.equal(groups[0].code,'TEAM');
  assert.deepEqual(groups[0].members.map(m=>m.player_id),['a','b','c']);
  assert.equal(groups[0].spanSeconds,22*60,'the span is first to last');
  assert.match(spanText(groups[0].spanSeconds),/within 22 min/);
});

test('Accounts reaching one mailbox are grouped however far apart they were made',()=>{
  const players=[
    {id:'a',name:'A',invite_code:'TEAM',created_at:'2026-01-01T00:00:00Z'},
    {id:'b',name:'B',invite_code:'OTHER',created_at:'2026-09-01T00:00:00Z'},
    {id:'c',name:'C',invite_code:'OTHER',created_at:'2026-09-02T00:00:00Z'},
  ];
  const emails=new Map([['a','billy@gmail.com'],['b','b.illy+arcade@gmail.com'],['c','someone@else.test']]);
  const totals=totalsIndex([{player_id:'a',game:'blocks',runs:4,best:900}]);
  const groups=duplicateGroups({players,emails,totals});
  const mailbox=groups.filter(g=>g.kind==='email');
  assert.equal(mailbox.length,1);
  assert.equal(mailbox[0].mailbox,'billy@gmail.com');
  assert.deepEqual(mailbox[0].members.map(m=>m.player_id),['a','b']);
  assert.equal(mailbox[0].members[0].runs,4,'what they have actually played rides along');
  assert.equal(mailbox[0].members[0].best.blocks,900);
  assert.equal(mailbox[0].members[1].runs,0);
});

test('The duplicates panel reads the real accounts, and says nothing when there is nothing to say',async()=>{
  const w=world();
  const token=await w.adminToken();
  const quiet=await w.view(token,{});
  assert.equal(quiet.body.duplicates.groups.length,0,'one admin on its own is not a duplicate');
  assert.match(duplicatePanel(quiet.body,GAME_LABELS),/Nothing to look at/);

  // Two accounts on one code, two minutes apart.
  const first=await w.join('one@peak.test','One');
  w.advance(120);
  const second=await w.join('two@peak.test','Two');
  w.score(first,'ridge',700);
  const view=await w.view(token,{});
  const group=view.body.duplicates.groups.find(g=>g.kind==='invite-code'&&g.members.length>=2);
  assert.ok(group,JSON.stringify(view.body.duplicates.groups));
  // All three joined on TEAM inside half an hour, the admin included — which is right: the check reports
  // what it sees and leaves the judging to a person.
  assert.deepEqual(group.members.map(m=>m.name).sort(),['Boss','One','Two']);
  assert.equal(group.members.some(m=>m.player_id===second.id),true,'the second signup is in the cluster');
  const mine=group.members.find(m=>m.player_id===first.id);
  assert.equal(mine.email,'one@peak.test','the address comes from auth, in one batched read');
  assert.equal(mine.runs,1);
  assert.equal(mine.best.ridge,700);
  const markup=duplicatePanel(view.body,GAME_LABELS);
  assert.match(markup,/Possible duplicate accounts/);
  assert.match(markup,/not acted on automatically/i,'the panel says what it is for');
  assert.ok(!markup.includes('<script'),'and escapes what it renders');
});

// ---------------------------------------------------------------- before paying a prize

test('A month&rsquo;s podium comes with the run behind each row, and the winner gets a checklist',async()=>{
  const w=world();
  const token=await w.adminToken();
  // On its own code and a day later, so the admin's own signup is not a duplicate signal against them.
  w.advance(24*60*60);
  const player=await w.join('winner@peak.test','Winner','OTHER');
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed,30);
  w.advance(b.moves*1.2);
  assert.equal((await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}})).status,200);

  const view=await w.view(token,{month:'2026-10'});
  const blocks=view.body.winners.games.find(g=>g.game==='blocks');
  assert.ok(blocks.podium.length>=1);
  const top=blocks.podium[0];
  assert.equal(top.rank,1);
  assert.equal(top.winner,true);
  assert.equal(top.score,b.score,'the verified score');
  assert.equal(top.runId,started.body.runId,'the run behind the row');
  assert.equal(top.moves,b.replay.log.length,'how many placements it took');
  assert.equal(top.gameSeconds,null,'Peak Blocks keeps no game clock');
  assert.ok(top.wallSeconds>0&&top.wallClock,'but the server timed it start to finish');
  assert.deepEqual(top.reasons,[],'nothing flagged');
  // The checklist answers what the stored run can answer, and asks for the button where it cannot.
  const byKey=Object.fromEntries(top.checklist.map(c=>[c.key,c]));
  assert.deepEqual(Object.keys(byKey).sort(),
    ['backups','duplicate','flags','history','reverified','timing'].sort());
  assert.equal(byKey.reverified.status,'action','only the button can answer this one');
  assert.equal(byKey.flags.status,'ok');
  assert.equal(byKey.timing.status,'ok');
  assert.equal(byKey.history.status,'ok');
  assert.equal(byKey.duplicate.status,'ok');
  assert.equal(byKey.backups.status,'warn','one on the podium means nothing to fall back on');
  const markup=winnerPanels(view.body);
  assert.match(markup,/Before paying a prize/);
  assert.match(markup,/data-reverify="/,'with a button to re-verify');
  assert.match(checklistMarkup(top.checklist),/data-check="reverified"/);
});

test('The checklist warns on the things the run already shows',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('flagged@peak.test','Flagged');
  for(const score of [40,38,36,34,32])w.score(player,'blocks',score);
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed,30);
  w.advance(45*60);
  assert.equal((await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}})).status,200);
  const view=await w.view(token,{month:'2026-10'});
  const top=view.body.winners.games.find(g=>g.game==='blocks').podium.find(r=>r.winner);
  const byKey=Object.fromEntries(top.checklist.map(c=>[c.key,c]));
  assert.equal(byKey.flags.status,'warn');
  assert.match(byKey.flags.detail,/open flag/);
  assert.equal(byKey.timing.status,'warn','the long wait is a timing remark');
  assert.match(byKey.timing.detail,/after starting/);
  assert.equal(byKey.history.status,'warn','and the score is far above their own best');
  assert.match(byKey.history.detail,/previous best/);
});

test('Re-verify replays the stored run and reports whether it still makes that score',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('check@peak.test','Check');
  const started=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b=blocksReplay(started.body.seed,20);
  w.advance(b.moves*1.2);
  assert.equal((await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:b.replay,claimed:b.score}})).status,200);

  const pass=await w.act(token,{action:'re-verify',id:started.body.runId});
  assert.equal(pass.status,200);
  assert.equal(pass.body.result.ok,true);
  assert.equal(pass.body.result.score,b.score);
  assert.equal(pass.body.result.replayed,b.score,'the replay still produces it');
  assert.equal(pass.body.result.segments.length,1);
  assert.equal(pass.body.result.segments[0].moves,b.replay.log.length);
  // Nothing was changed by asking.
  const after=w.store.runs.get(started.body.runId);
  assert.equal(after.status,'closed');
  assert.equal(after.score,b.score);
  assert.equal(after.flagged,false);
  assert.equal(w.store.adminEntries.length,0,'and a question that changes nothing is not logged as an action');

  // A run whose stored score no longer matches its replay is reported, not corrected.
  after.score=b.score+5000;
  const disagree=await w.act(token,{action:'re-verify',id:started.body.runId});
  assert.equal(disagree.body.result.ok,false);
  assert.equal(disagree.body.result.replayed,b.score);
  assert.equal(disagree.body.result.score,b.score+5000);
  assert.equal(w.store.runs.get(started.body.runId).score,b.score+5000,'re-verify does not fix it either');

  // A run with a doctored replay fails with the verifier's own reason.
  const bad=await w.api.start({token:player.token,body:{game:'blocks'}});
  const b2=blocksReplay(bad.body.seed,10);
  w.advance(b2.moves*1.2);
  await w.api.finish({token:player.token,body:{runId:bad.body.runId,replay:b2.replay,claimed:b2.score}});
  w.store.runs.get(bad.body.runId).replays=[{...b2.replay,log:[...b2.replay.log,['p',0,99,99]]}];
  const broken=await w.act(token,{action:'re-verify',id:bad.body.runId});
  assert.equal(broken.body.result.ok,false);
  assert.match(broken.body.result.reason,/Illegal step|Replay failed/);

  assert.equal((await w.act(token,{action:'re-verify',id:'nope'})).status,404);
  // And it is admin-only, like everything else behind that route.
  assert.equal((await w.api.admin({token:player.token,body:{action:'re-verify',id:started.body.runId},method:'POST'})).status,403);
});

test('Re-verify follows a Sequence run level by level',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('seq@peak.test','Seq');
  const started=await w.api.start({token:player.token,body:{game:'sequence'}});
  const l1=sequenceReplay(started.body.seed,1);
  assert.equal(l1.won,true,'the bot clears level 1');
  w.advance(l1.seconds+60);
  const first=await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:l1.replay,claimed:l1.score}});
  assert.equal(first.status,200);
  assert.equal(first.body.done,false);
  const l2=sequenceReplay(first.body.nextSeed,first.body.nextLevel);
  w.advance(l2.seconds+60);
  assert.equal((await w.api.finish({token:player.token,body:{runId:started.body.runId,replay:l2.replay,claimed:l2.score}})).status,200);

  const result=(await w.act(token,{action:'re-verify',id:started.body.runId})).body.result;
  assert.equal(result.segments.length,2,'a level at a time');
  assert.deepEqual(result.segments.map(s=>s.level),[1,2]);
  assert.equal(result.ok,true);
  assert.equal(result.replayed,w.store.runs.get(started.body.runId).score,'and the levels add up to the run');
});
