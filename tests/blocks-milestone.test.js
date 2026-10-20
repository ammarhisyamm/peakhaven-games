// Peak Blocks: the milestone reward (replay v3) and the combo payoff.
// The reward changes the rules, so it has to be verifiable on the server from the seed and the log alone,
// and v1 and v2 runs have to go on verifying with the rules they were played on. The combo feel and the
// clear cue are pure functions here, so the numbers and the cue names are covered without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlocks,blocksPlace,blocksBomb,blocksUndo,blocksShuffle,blocksResult,replayBlocks,
 BLOCK_TOOLS,BLOCK_MILESTONE,BLOCKS_REPLAY_VERSION,milestoneReward,comboFeedback,clearedLines,COMBO_FEEL} from '../dist/blocks-core.js';
import {placements,placeBlock} from '../dist/puzzle-rules.js';
import {clearEvent,cueFor,COMBO_LEVELS} from '../dist/game-audio.js';

const DOT=[[0,0]];
// Hands the run a board that is one square short of a full row, and the one piece that finishes it.
// A scripted board like this cannot be replayed (the server deals its own trays), so it is only used for
// the rules; the replay tests below play a real run.
function clearOneLine(g,row=7){
 const grid=g.state.grid.map(r=>[...r]);
 for(let c=1;c<8;c++)grid[row][c]=1;
 g.state.grid=grid;g.state.tray=[{shape:DOT,color:1},null,null];g.state.selected=0;
 return blocksPlace(g,0,row,0);
}

test('every 25 lines pays one tool, rotating Bomb, then Undo, then Shuffle',()=>{
 const g=createBlocks(99);
 assert.equal(g.version,BLOCKS_REPLAY_VERSION);
 assert.equal(BLOCKS_REPLAY_VERSION,3);
 const paid=[];
 for(let i=1;i<=100;i++){
  const out=clearOneLine(g);
  assert.equal(out.lines,1,`placement ${i} should clear its line`);
  for(const reward of out.rewards)paid.push({...reward,at:g.state.lines});
 }
 assert.deepEqual(paid.map(r=>r.tool),['bomb','undo','shuffle','bomb']);
 assert.deepEqual(paid.map(r=>r.at),[25,50,75,100]);
 assert.deepEqual(paid.map(r=>r.lines),[25,50,75,100]);
 assert.equal(paid[0].label,'Level 25! Free Bomb');
 assert.equal(paid[1].label,'Level 50! Free Undo');
 assert.equal(paid[2].label,'Level 75! Free Shuffle');
 assert.equal(g.tools.bomb,BLOCK_TOOLS.bomb+2);
 assert.equal(g.tools.undo,BLOCK_TOOLS.undo+1);
 assert.equal(g.tools.shuffle,BLOCK_TOOLS.shuffle+1);
 // The reward is tools, never points: the scoring is untouched.
 assert.equal(BLOCK_MILESTONE.every,25);
 assert.deepEqual([...BLOCK_MILESTONE.tools],['bomb','undo','shuffle']);
 assert.deepEqual(milestoneReward(4),{milestone:4,lines:100,tool:'bomb',label:'Level 100! Free Bomb'});
});

test('a placement that clears several lines at once still pays the milestone it crossed',()=>{
 const g=createBlocks(7);
 // 24 lines first, then a board where a single piece clears two rows at once.
 for(let i=0;i<24;i++)clearOneLine(g);
 assert.equal(g.state.lines,24);
 assert.equal(g.rewarded,0);
 const grid=g.state.grid.map(r=>[...r]);
 for(let c=1;c<8;c++){grid[6][c]=1;grid[7][c]=1;}
 g.state.grid=grid;g.state.tray=[{shape:[[0,0],[0,1]],color:1},null,null];g.state.selected=0;
 const out=blocksPlace(g,0,6,0);
 assert.equal(out.lines,2);
 assert.equal(g.state.lines,26);
 assert.deepEqual(out.rewards.map(r=>r.tool),['bomb']);
 // A four-line clear across the 50 mark pays that milestone, once. One placement can clear at most 16
 // lines, so with a 25-line milestone it can never cross two; the rules loop over them anyway, so the
 // promise holds whatever the interval becomes.
 for(let i=0;i<22;i++)clearOneLine(g);
 assert.equal(g.state.lines,48);
 const wide=g.state.grid.map(r=>[...r]);
 for(let r=4;r<8;r++)for(let c=1;c<8;c++)wide[r][c]=1;
 g.state.grid=wide;g.state.tray=[{shape:[[0,0],[0,1],[0,2],[0,3]],color:1},null,null];g.state.selected=0;
 const big=blocksPlace(g,0,4,0);
 assert.equal(big.lines,4);
 assert.equal(g.state.lines,52);
 assert.deepEqual(big.rewards.map(r=>r.tool),['undo']);
 assert.equal(g.rewarded,2);
});

test('v1 and v2 runs get no milestone, so an old best cannot move',()=>{
 for(const version of [1,2]){
  const g=createBlocks(99,version);
  for(let i=0;i<60;i++){const out=clearOneLine(g);assert.deepEqual(out.rewards,[]);}
  assert.equal(g.state.lines,60);
  assert.equal(g.rewarded,0);
  assert.deepEqual(g.tools,{...BLOCK_TOOLS});
 }
});

test('Undo cannot cash the same milestone twice',()=>{
 const g=createBlocks(99);
 for(let i=0;i<25;i++)clearOneLine(g);
 assert.equal(g.rewarded,1);
 const bombs=g.tools.bomb;
 assert.equal(blocksUndo(g),true);
 assert.equal(g.state.lines,24,'Undo rewinds the lines');
 assert.equal(g.tools.bomb,bombs,'but not the tool it already handed out');
 // Clearing back over the line must not pay again.
 const out=clearOneLine(g);
 assert.equal(g.state.lines,25);
 assert.deepEqual(out.rewards,[]);
 assert.equal(g.tools.bomb,bombs);
 assert.equal(g.rewarded,1);
});

// A greedy player: take the placement that clears the most, and reach for a tool when nothing fits.
function play(seed,{untilLines=25,limit=4000}={}){
 const g=createBlocks(seed);
 const pick=()=>{
  let best=null;
  g.state.tray.forEach((p,i)=>{
   if(!p)return;
   for(const [r,c] of placements(g.state.grid,p.shape)){
    const out=placeBlock(g.state.grid,p.shape,r,c,p.color);
    const score=out.lines*1000+out.grid.flat().filter(v=>!v).length;
    if(!best||score>best.score)best={score,i,r,c};
   }
  });
  return best;
 };
 const fullest=()=>{
  let hit=null;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
   const n=g.state.grid.flatMap((row,rr)=>row.filter((v,cc)=>v&&Math.abs(rr-r)<=1&&Math.abs(cc-c)<=1)).length;
   if(!hit||n>hit.n)hit={n,r,c};
  }
  return hit;
 };
 for(let i=0;i<limit&&!g.ended&&g.state.lines<untilLines;i++){
  const best=pick();
  if(best){blocksPlace(g,best.i,best.r,best.c);continue;}
  if(blocksShuffle(g))continue;
  const hit=fullest();
  if(!hit||!blocksBomb(g,hit.r,hit.c))break;
 }
 return g;
}

test('the server verifies the reward: the extra Bomb replays only because the milestone paid for it',()=>{
 const g=play(2024);
 assert.ok(g.state.lines>=BLOCK_MILESTONE.every,`the run should reach a milestone, got ${g.state.lines} lines`);
 assert.equal(g.rewarded,1);
 // Spend every Bomb there is, which is only possible because of the reward.
 let used=0;
 while(g.tools.bomb>0&&!g.ended){
  let hit=null;
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
   const n=g.state.grid.flatMap((row,rr)=>row.filter((v,cc)=>v&&Math.abs(rr-r)<=1&&Math.abs(cc-c)<=1)).length;
   if(!hit||n>hit.n)hit={n,r,c};
  }
  if(!hit?.n||!blocksBomb(g,hit.r,hit.c))break;
  used++;
 }
 assert.equal(used,BLOCK_TOOLS.bomb+1,`the run should spend ${BLOCK_TOOLS.bomb+1} bombs, got ${used}`);
 const result=blocksResult(g);
 assert.equal(result.replay.v,3);
 // The server plays the log again from the seed and reaches the same score, reward and all.
 const verified=replayBlocks(result.replay);
 assert.equal(verified.score,result.score);
 assert.equal(verified.lines,result.lines);
 assert.equal(verified.moves,result.moves);
 // And the same log claimed as v2 is rejected: without the milestone, the fourth Bomb never existed.
 assert.throws(()=>replayBlocks({...result.replay,v:2}),/Illegal step/);
});

test('a log that spends a tool it was never paid is rejected',()=>{
 const g=play(31,{untilLines:5});
 const result=blocksResult(g);
 // Four bombs on a run that never reached 25 lines.
 const forged={...result.replay,log:[...result.replay.log,['b',3,3],['b',3,4],['b',4,3],['b',4,4]]};
 assert.throws(()=>replayBlocks(forged),/Illegal step/);
});

test('the clear cue carries the combo level, with a separate big clear',()=>{
 assert.equal(COMBO_LEVELS,5);
 assert.equal(clearEvent({combo:1}),'clear1');
 assert.equal(clearEvent({combo:3}),'clear3');
 assert.equal(clearEvent({combo:5}),'clear5');
 assert.equal(clearEvent({combo:9}),'clear5','a longer combo keeps the top level');
 assert.equal(clearEvent({}),'clear1');
 assert.equal(clearEvent({combo:3,big:true}),'bigClear','the big clear is its own cue, not a level');
 // Every name it can return has to resolve to a real cue, or a clear would fall silent.
 for(let level=1;level<=COMBO_LEVELS;level++){
  const cue=cueFor('blocks',`clear${level}`);
  assert.ok(cue,`clear${level} resolves to a cue`);
  assert.equal(cue.file,`blk-combo-${level}`,'each level has its own marimba cascade');
  assert.equal(cue.rate,1,'the cascades are already in tune: no Blocks pitch shift on top');
 }
 const big=cueFor('blocks','bigClear');
 assert.ok(big);
 assert.equal(big.file,'blk-combo-big');
 // The old samples stay for the cues that still use them, so the Bomb and NEW BEST! are unchanged.
 assert.equal(cueFor('blocks','merge').file,'blk-clear');
 assert.equal(cueFor('blocks','big').file,'blk-big');
 for(const combo of [1,2,3,4,5,6,20])for(const flag of [false,true]){
  assert.ok(cueFor('blocks',clearEvent({combo,big:flag})),`combo ${combo}${flag?' big':''} has a cue`);
 }
});

test('the combo feel grows with the combo, and motion off means no shake',()=>{
 assert.deepEqual(comboFeedback({lines:0,combo:0}),{lines:0,combo:0,level:0,big:false,shake:0,ms:0,label:''});
 const single=comboFeedback({lines:1,combo:1});
 assert.equal(single.shake,0,'one line and no combo is a tap, not an event');
 assert.equal(single.label,'');
 const three=comboFeedback({lines:1,combo:3});
 assert.equal(three.label,'COMBO x3');
 assert.equal(three.level,3);
 assert.ok(three.shake>0);
 assert.ok(comboFeedback({lines:1,combo:4}).shake>three.shake,'a longer combo shakes harder');
 assert.ok(comboFeedback({lines:2,combo:1}).big,'two lines at once is a big clear');
 assert.ok(comboFeedback({lines:2,combo:1}).shake>0);
 assert.ok(comboFeedback({lines:1,combo:1,perfect:true}).big,'and so is emptying the board');
 assert.equal(comboFeedback({lines:4,combo:9}).shake,COMBO_FEEL.max,'the shake is capped');
 assert.equal(comboFeedback({lines:4,combo:9}).level,COMBO_LEVELS,'and the feel levels match the cues');
 const quiet=comboFeedback({lines:4,combo:9},{motion:false});
 assert.equal(quiet.shake,0,'reduced motion means no shake at all');
 assert.equal(quiet.ms,0);
 assert.equal(quiet.label,'COMBO x9','but the count is still shown');
});

test('clearedLines names the whole rows and columns a clear took out',()=>{
 const cleared=[];
 for(let c=0;c<8;c++)cleared.push([3,c]);
 for(let r=0;r<8;r++)if(r!==3)cleared.push([r,5]);
 const lines=clearedLines(cleared);
 assert.deepEqual(lines.rows,[3]);
 assert.deepEqual(lines.cols,[5]);
 // A part-row is not a line: the burst must not fire along it.
 assert.deepEqual(clearedLines([[1,1],[1,2],[1,3]]),{rows:[],cols:[]});
 assert.deepEqual(clearedLines(),{rows:[],cols:[]});
});
