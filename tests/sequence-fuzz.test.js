// Sequence fuzz: a random bot and a greedy bot over 200 seeds each, on levels 1-60, with the game's
// invariants checked after every fixed step.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
globalThis.Image=class{complete=false;naturalWidth=0;};
const {SequenceEngine}=await import('../dist/tryout-games.js');
const {hasSequenceMove,sequenceMatches,sequencePalette,sequenceTarget,SEQUENCE_MOVES}=await import('../dist/sequence-rules.js');
const {createRandom}=await import('../dist/rng.js');
const {replaySequence}=await import('../tools/replay.mjs');
const {greedyMove,randomMove,driveSequence}=await import('../tools/sequence-bot.mjs');

const noop=()=>{};
function canvas(){const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>ctx,set:(t,k,v)=>(t[k]=v,true)});return {getContext:()=>ctx,getBoundingClientRect:()=>({width:480,height:720,left:0,top:0}),addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};}
const SEEDS=200,MAX_BUSY=120*30; // no single move may keep the board busy for 30 s

function fuzz(seed,bot){
  const level=1+(seed*13+(bot==='random'?7:0))%60,palette=sequencePalette(level),target=sequenceTarget(level),rand=createRandom(seed^0x5eed);
  let result=null,ends=0;const cb={hud:noop,message:noop,sound:noop,effect:noop,ready:noop,end(r){ends++;result??=r;}};
  const e=new SequenceEngine(canvas(),cb,{seed,level,motion:bot==='random'});
  const pick=bot==='greedy'?greedyMove:b=>randomMove(b,rand);
  const where=()=>`${bot} seed ${seed} level ${level} tick ${e.ticks}`;
  let lastScore=0,lastMoves=SEQUENCE_MOVES,busy=0;
  const check=g=>{
    for(const k of ['score','moves','pending','chain','time'])assert.ok(Number.isFinite(g[k]),`${k} is ${g[k]} at ${where()}`);
    assert.equal(g.board.length,49);
    for(const v of g.board)assert.ok(Number.isInteger(v)&&(v>=0&&v<palette||v===-1&&g.phase==='clear'),`cell ${v} in phase ${g.phase} at ${where()}`);
    assert.ok(g.moves>=0&&g.moves<=lastMoves&&lastMoves-g.moves<=1,`moves ${lastMoves} -> ${g.moves} at ${where()}`);
    assert.ok(g.score>=lastScore&&g.score%50===0,`score ${lastScore} -> ${g.score} at ${where()}`);
    lastScore=g.score;lastMoves=g.moves;
    if(g.pending>0){assert.ok(g.phase,`pending with no phase at ${where()}`);assert.ok(++busy<MAX_BUSY,`stuck in ${g.phase} at ${where()}`);}
    else{busy=0;assert.equal(g.phase,null,`phase ${g.phase} with nothing pending at ${where()}`);
      if(!g.ended){
        // Idle and still playing: the level is undecided, settled, and has a swap to make.
        assert.ok(g.score<target&&g.moves>0,`should have ended at ${where()}`);
        assert.equal(sequenceMatches(g.board).size,0,`ready-made line at ${where()}`);
        assert.equal(hasSequenceMove(g.board),true,`no legal swap at ${where()}`);
      }}
  };
  driveSequence(e,pick,{think:()=>bot==='random'?Math.floor(rand()*30):0,onStep:check});
  assert.equal(e.ended,true,`never ended: ${where()}`);assert.equal(ends,1);
  assert.equal(result.won,e.score>=target);assert.ok(result.won||e.moves===0,`ended early at ${where()}`);
  assert.equal(result.moves,SEQUENCE_MOVES-e.moves);assert.equal(result.score,e.score);
  e.destroy();
  return result;
}

for(const bot of ['random','greedy'])test(`Sequence ${bot} bot: ${SEEDS} seeds hold every invariant and every tenth run replays`,async()=>{
  let wins=0;
  for(let seed=1;seed<=SEEDS;seed++){const r=fuzz(seed,bot);if(r.won)wins++;
    if(seed%10===0){const again=await replaySequence(r.replay);assert.equal(again.score,r.score,`${bot} seed ${seed}`);assert.equal(again.unusedInputs,0);}}
  if(bot==='greedy')assert.ok(wins>=SEEDS*.8,`greedy won ${wins}/${SEEDS}`);
});
