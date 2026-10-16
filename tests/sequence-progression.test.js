import test from 'node:test';
import assert from 'node:assert/strict';
import {sequenceLevel,createSequenceProgress,sequenceGoals,sequenceComplete,applySequenceWave,progressionExchange,progressionMove,settleProgression,createProgressionBoard,sequenceBrief} from '../dist/sequence-progression.js';
import {sequenceMatches,sequenceExchange} from '../dist/sequence-rules.js';
import {createRandom,SIM_STEP} from '../dist/rng.js';
globalThis.window={devicePixelRatio:1};globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.Image=class{};
const {SequenceEngine}=await import('../dist/tryout-games.js');
const {driveSequence,greedyMove,SEQUENCE_PAIRS}=await import('../tools/sequence-bot.mjs');
const {replaySequence}=await import('../tools/replay.mjs');
const noop=()=>{},canvas=()=>({getContext:()=>new Proxy({},{get:()=>noop}),getBoundingClientRect:()=>({width:480,height:720}),addEventListener:noop,removeEventListener:noop});
function engine(seed,level){let result;const messages=[],goals=[];const e=new SequenceEngine(canvas(),{hud:noop,sound:noop,message:m=>messages.push(m),goals:g=>goals.push(g),end:r=>result=r},{seed,level,motion:false,rulesVersion:2});return {e,messages,goals,result:()=>result};}

test('Sequence introduces mechanics gradually, changes layouts and caps finite late-game objectives',()=>{
 assert.equal(sequenceLevel(2).ice.some(Boolean),false);assert.ok(sequenceLevel(3).ice.includes(1));assert.equal(sequenceLevel(4).ice.includes(2),false);assert.ok(sequenceLevel(5).ice.includes(2));
 assert.equal(sequenceLevel(6).locks.some(Boolean),false);assert.ok(sequenceLevel(7).locks.some(Boolean));assert.equal(sequenceLevel(8).collect,null);assert.equal(sequenceLevel(9).collect.count,9);
 assert.notDeepEqual(sequenceLevel(9).ice,sequenceLevel(10).ice);
 for(const level of [1,3,5,7,9,16,50,100,10000]){const c=sequenceLevel(level);assert.ok(c.target<=4500);assert.ok(c.ice.filter(Boolean).length<=8);assert.ok(c.locks.filter(Boolean).length<=4);assert.ok(!c.collect||c.collect.type<c.palette&&c.collect.count<=18);}
 assert.match(sequenceBrief(9),/collect 9/);assert.match(sequenceBrief(5),/two-layer ice/);
});
test('Two-layer ice takes separate waves, and touching it from several matched cells still counts once',()=>{
 const c=sequenceLevel(5),state=createSequenceProgress(c);state.ice.fill(0);state.ice[24]=2;
 const board=Array(49).fill(0),matches=new Set([17,23,25,31]);
 const first=applySequenceWave(c,state,board,matches),second=applySequenceWave(c,first,board,new Set([24]));
 assert.equal(first.ice[24],1);assert.equal(second.ice[24],0);assert.equal(state.ice[24],2,'pure state transition');assert.equal(applySequenceWave(c,second,board,matches).ice[24],0);
});
test('Traps block swaps and gravity until a match on or beside them frees them',()=>{
 const c=sequenceLevel(9),state=createSequenceProgress(c);state.locks.fill(false);state.locks[24]=true;
 const board=Array.from({length:49},(_,i)=>Math.floor(i/7));board[38]=-1;board[10]=-1;
 assert.equal(progressionExchange(board,24,25,state),null);
 const settled=settleProgression(board,()=>.2,7,state);assert.equal(settled.board[24],board[24]);assert.equal(settled.board[31],1);assert.equal(settled.board[38],board[31]);assert.ok(settled.board.every(v=>v>=0));
 assert.equal(applySequenceWave(c,state,board,new Set([0,1,2])).locks[24],true);
 const released=applySequenceWave(c,state,board,new Set([23]));assert.equal(released.locks[24],false);assert.ok(progressionExchange(board,24,25,released));
});
test('Collection counts only matched target crystals and winning requires all objectives as well as points',()=>{
 const c=sequenceLevel(9),state=createSequenceProgress(c),board=Array(49).fill(c.collect.type);const next=applySequenceWave(c,state,board,new Set([0,1,2]));
 assert.equal(next.collected,3);assert.equal(sequenceComplete(99999,c,next),false);
 next.ice.fill(0);next.locks.fill(false);next.collected=c.collect.count;assert.equal(sequenceComplete(c.target-1,c,next),false);assert.equal(sequenceComplete(c.target,c,next),true);
 assert.ok(sequenceGoals(c,next).every(g=>g.done===g.total&&g.left===0));
});
test('Progression openings and bounded fallback are match-free and have a usable unlocked swap',()=>{
 for(const level of [3,5,7,9,16,50])for(let seed=1;seed<=60;seed++){
  const c=sequenceLevel(level),s=createSequenceProgress(c),b=createProgressionBoard(c,createRandom(seed),s);
  assert.equal(sequenceMatches(b).size,0);assert.ok(progressionMove(b,s));assert.ok(b.every(v=>Number.isInteger(v)&&v>=0&&v<c.palette));
 }
 for(const rng of [()=>0,()=>.999999]){
  const c=sequenceLevel(50),s=createSequenceProgress(c),old=createProgressionBoard(c,createRandom(42),s),b=createProgressionBoard(c,rng,s,old);
  assert.equal(sequenceMatches(b).size,0);assert.ok(progressionMove(b,s));for(let i=0;i<49;i++)if(s.locks[i])assert.equal(b[i],old[i]);
 }
});
test('Trapped taps, invalid swaps and paused input never spend a move or enter the replay',()=>{
 const {e}=engine(21,9),i=e.progress.locks.findIndex(Boolean);e.choose(i,i+1);assert.equal(e.inputs.length,0);assert.equal(e.moves,25);
 e.choose(.5,1.5);assert.equal(e.inputs.length,0);
 const pair=SEQUENCE_PAIRS.find(([a,b])=>!e.progress.locks[a]&&!e.progress.locks[b]&&!sequenceMatches(sequenceExchange(e.board,a,b)).size);
 const old=e.board.slice();e.choose(...pair);for(let t=0;t<100;t++)e.step(SIM_STEP);assert.deepEqual(e.board,old);assert.equal(e.moves,25);
 e.pause();e.choose(...e.findMove());assert.equal(e.inputs.length,1);e.destroy();
});
test('Reaching points alone does not finish a level; zero moves with remaining ice is a loss',()=>{
 const x=engine(2,5),e=x.e;e.score=e.target;e.finishMove();assert.equal(e.ended,false);e.moves=0;e.finishMove();assert.equal(x.result().won,false);assert.ok(x.result().objectives.some(g=>g.left));assert.equal(x.result().target,e.target);e.destroy();
});
test('A dead board reshuffle preserves objective progress and trapped crystals without spending moves',()=>{
 const {e}=engine(42,12);e.board=Array.from({length:49},(_,i)=>(Math.floor(i/7)+3*(i%7))%4);const before=e.board.slice(),progress=structuredClone(e.progress);e.moves=10;e.finishMove();assert.equal(e.moves,10);assert.deepEqual(e.progress,progress);assert.ok(e.findMove());for(let i=0;i<49;i++)if(progress.locks[i])assert.equal(e.board[i],before[i]);e.destroy();
});
test('Progression fuzz: 200 full runs remain playable, end once and rebuild under v2 replay',async()=>{
 let wins=0,losses=0;
 for(let seed=1;seed<=200;seed++){
  const level=[3,5,7,9,12,16,20,30,50,100][seed%10],x=engine(seed,level),e=x.e;let moves=25,score=0,busy=0;
  driveSequence(e,greedyMove,{onStep:g=>{assert.ok(g.moves>=0&&g.moves<=moves);assert.ok(g.score>=score);moves=g.moves;score=g.score;assert.ok(g.progress.ice.every(v=>v>=0&&v<=2));assert.ok(g.board.every(v=>Number.isInteger(v)&&v>=0&&v<g.palette));if(g.pending)assert.ok(++busy<3600);else{busy=0;if(!g.ended){assert.ok(g.findMove());assert.equal(sequenceMatches(g.board).size,0);}}}});
  const r=x.result();assert.ok(r);assert.equal(r.won,e.complete());assert.equal(r.replay.v,2);assert.ok(r.won||e.moves===0);if(r.won)wins++;else losses++;
  if(seed%4===0){const replay=await replaySequence(r.replay);assert.equal(replay.score,r.score);assert.equal(replay.won,r.won);assert.equal(replay.unusedInputs,0);}
  e.finish();assert.equal(x.result(),r);e.destroy();
 }
 assert.ok(wins>100);assert.ok(losses>0,'later objectives can be failed');
});
