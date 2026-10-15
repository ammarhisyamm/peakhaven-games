// Sequence: seeded boards, refills and reshuffles; replays that rebuild the real score; the no-moves path.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
globalThis.Image=class{complete=false;naturalWidth=0;};
const {SequenceEngine}=await import('../dist/tryout-games.js');
const {createSequenceBoard,hasSequenceMove,sequenceMatches,sequenceExchange,sequenceTarget,sequencePalette,SEQUENCE_MOVES,SEQUENCE_TARGET_CAP}=await import('../dist/sequence-rules.js');
const {SIM_STEP,createRandom}=await import('../dist/rng.js');
const {replaySequence}=await import('../tools/replay.mjs');
const {playSequence,greedyMove,randomMove,driveSequence}=await import('../tools/sequence-bot.mjs');

const noop=()=>{};
function canvas(width=480,height=720){const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>ctx,set:(t,k,v)=>(t[k]=v,true)});return {getContext:()=>ctx,getBoundingClientRect:()=>({width,height,left:0,top:0}),addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};}
function callbacks(){const out={result:null,messages:[]};out.cb={hud:noop,sound:noop,effect:noop,ready:noop,message(m){out.messages.push(m);},end(r){out.result??=r;}};return out;}
const engine=(seed,level=1,out=callbacks())=>new SequenceEngine(canvas(),out.cb,{seed,level,rulesVersion:1,motion:false});
// No legal swap and no line: rows run 0,3,2,1,... shifted by one each row.
const DEAD=Array.from({length:49},(_,i)=>(Math.floor(i/7)+3*(i%7))%4);

test('A Sequence seed fixes the opening board; another seed gives another board',()=>{
  for(const level of [1,8,20]){
    const a=engine(42,level),b=engine(42,level),c=engine(43,level);
    assert.deepEqual(a.board,b.board);assert.notDeepEqual(a.board,c.board);
    assert.deepEqual(a.board,createSequenceBoard(level,createRandom(42)),'the opening board is the first draws of the seed');
    for(const e of [a,b,c])e.destroy();
  }
});

test('Sequence play never touches Math.random: boards, refills and reshuffles all use the seed',()=>{
  const real=Math.random;let calls=0;Math.random=()=>{calls++;return real();};
  try{
    for(const [seed,level] of [[14,15],[16,17],[3,1],[9,30]]){const e=engine(seed,level);driveSequence(e,greedyMove);assert.ok(e.ended);e.destroy();}
  }finally{Math.random=real;}
  assert.equal(calls,0);
});

test('The live engine and the pure rules playthrough agree move for move',()=>{
  for(const [seed,level] of [[1,1],[2,6],[14,15],[16,17],[5,40],[7,60]]){
    const pure=playSequence({level,seed}),out=callbacks(),e=engine(seed,level,out);driveSequence(e,greedyMove);
    assert.equal(e.score,pure.score,`seed ${seed} level ${level}`);assert.equal(out.result.won,pure.won);assert.equal(out.result.moves,pure.moves);
    assert.deepEqual(out.result.replay.moves.map(m=>m.slice(1)),pure.log);e.destroy();
  }
});

test('Sequence replays rebuild the real score, including dud swaps, think time and a level quit early',async()=>{
  for(let seed=1;seed<=12;seed++){
    const level=1+(seed*7)%60,rand=createRandom(seed),out=callbacks(),e=engine(seed,level,out);
    const pick=seed%2?greedyMove:b=>randomMove(b,rand);
    driveSequence(e,pick,{think:()=>Math.floor(rand()*90)});
    const rep=out.result.replay;
    assert.equal(rep.v,1);assert.equal(rep.game,'sequence');assert.equal(rep.seed,seed);assert.equal(rep.level,level);assert.equal(rep.step,SIM_STEP);assert.equal(rep.endTick,e.ticks);
    const again=await replaySequence(JSON.parse(JSON.stringify(rep)));
    assert.equal(again.score,out.result.score,`seed ${seed}`);assert.equal(again.won,out.result.won);assert.equal(again.unusedInputs,0);e.destroy();
  }
  // Quitting part-way: finish() also carries a replay that stops at the same tick.
  const out=callbacks(),e=engine(77,40,out);driveSequence(e,greedyMove,{maxTicks:400});assert.equal(e.ended,false);e.finish();
  const again=await replaySequence(out.result.replay);assert.equal(again.score,out.result.score);assert.equal(again.won,false);e.destroy();
});

test('A doctored Sequence replay does not reproduce the claimed score',async()=>{
  const out=callbacks(),e=engine(31,25,out);driveSequence(e,greedyMove);const rep=out.result.replay;e.destroy();
  assert.notEqual((await replaySequence({...rep,seed:32})).score,out.result.score,'another seed deals other crystals');
  const easier=await replaySequence({...rep,level:1});assert.equal(easier.level,1,'the level a replay is scored at is reported, not trusted');
  await assert.rejects(replaySequence({...rep,moves:[[0,0.5,1.5]]}),/Bad Sequence move log/);
  await assert.rejects(replaySequence({...rep,game:'bond'}),/Not a Sequence replay/);
  const extra=await replaySequence({...rep,moves:[...rep.moves,[rep.endTick-1,0,48]]});assert.equal(extra.unusedInputs,1,'a swap the game would refuse is counted, not played');
});

test('sequenceExchange refuses fractional cells instead of writing odd keys into the board',()=>{
  const board=createSequenceBoard(1,createRandom(1));
  assert.equal(sequenceExchange(board,0.5,1.5),null);assert.equal(sequenceExchange(board,'1',2),null);assert.ok(sequenceExchange(board,1,2));
});

// ---------- No legal move ----------
test('The fixed dead board really has no move and no line',()=>{
  assert.equal(sequenceMatches(DEAD).size,0);assert.equal(hasSequenceMove(DEAD),false);
});

test('A board with no legal move reshuffles from the seed without spending a move',()=>{
  const boards=[];
  for(let run=0;run<2;run++){
    const out=callbacks(),e=engine(5,23,out);e.board=DEAD.slice();e.moves=17;e.score=200;
    const expected=createSequenceBoard(23,createRandom(e.random.state()));
    e.finishMove();
    assert.equal(e.moves,17,'no move spent');assert.equal(e.score,200);assert.equal(e.ended,false);
    assert.ok(out.messages.includes('Fresh crystals. No move used.'));
    assert.equal(hasSequenceMove(e.board),true,'the new board has a move');
    assert.equal(sequenceMatches(e.board).size,0,'and no ready-made lines');
    assert.ok(e.board.every(v=>Number.isInteger(v)&&v>=0&&v<sequencePalette(23)));
    assert.deepEqual(e.board,expected,'drawn from the engine generator');
    boards.push(e.board.slice());e.destroy();
  }
  assert.deepEqual(boards[0],boards[1],'same seed, same reshuffle');
  const other=engine(6,23);other.board=DEAD.slice();other.finishMove();assert.notDeepEqual(other.board,boards[0]);other.destroy();
});

test('A dead board left by a real cascade reshuffles mid-level, and the run still replays',async()=>{
  // Seeds the pure playthrough says hit a dead board with 7 colours.
  let seen=0;
  for(const [seed,level] of [[5,21],[6,22],[9,25]]){
    const pure=playSequence({level,seed});assert.ok(pure.reshuffles>0);
    const out=callbacks(),e=engine(seed,level,out);let movesAtIdle=[];
    driveSequence(e,greedyMove,{onStep:g=>{if(!g.pending&&!g.ended){assert.equal(hasSequenceMove(g.board),true);assert.equal(sequenceMatches(g.board).size,0);movesAtIdle.push(g.moves);}}});
    const reshuffles=out.messages.filter(m=>m==='Fresh crystals. No move used.').length;
    assert.equal(reshuffles,pure.reshuffles);seen+=reshuffles;
    assert.equal(out.result.moves,pure.moves,'reshuffles never cost a move');
    assert.equal((await replaySequence(out.result.replay)).score,out.result.score);e.destroy();
  }
  assert.ok(seen>0);
});

test('Even a generator stuck on one value deals a playable board at every colour count',()=>{
  for(const level of [1,6,11,16,60])for(const r of [()=>0,()=>.999999]){
    const b=createSequenceBoard(level,r);assert.equal(sequenceMatches(b).size,0);assert.equal(hasSequenceMove(b),true);
  }
});

// ---------- Targets ----------
test('Sequence targets keep levels 1-50 as they were, then ease toward a ceiling instead of climbing for ever',()=>{
  for(let l=1;l<=50;l++)assert.equal(sequenceTarget(l),350+150*l);
  let prev=sequenceTarget(50);
  for(let l=51;l<=400;l++){const t=sequenceTarget(l);assert.ok(t>=prev&&t-prev<=150,`level ${l}: ${prev} -> ${t}`);assert.ok(t<=SEQUENCE_TARGET_CAP);assert.equal(t%50,0);prev=t;}
  assert.equal(sequenceTarget(200),SEQUENCE_TARGET_CAP);assert.equal(sequenceTarget(0),sequenceTarget(1));
  assert.equal(SEQUENCE_MOVES,25);
});

test('Sequence ignores a second pointer and clears held gestures on lost capture and pause',()=>{
 const e=engine(42),g=e.geometry(),point=i=>({clientX:g.x+(i%7+.5)*g.cell,clientY:g.y+(Math.floor(i/7)+.5)*g.cell,pointerId:1});
 e.onpointerdown(point(0));const origin=[...e.pointerStart];e.onpointerdown({...point(20),pointerId:2});assert.deepEqual(e.pointerStart,origin);
 e.onpointermove({...point(1),pointerId:2});assert.equal(e.inputs.length,0);
 e.onlostpointercapture(point(0));assert.equal(e.pointerStart,null);assert.equal(e.pointerId,null);
 e.onpointerdown(point(0));e.pause();e.pause(false);e.onpointerup(point(1));assert.equal(e.inputs.length,0);
 e.onpointerdown(point(0));e.onpointermove(point(1));assert.equal(e.inputs.length,1,'a new gesture works after interruption');e.destroy();
});
