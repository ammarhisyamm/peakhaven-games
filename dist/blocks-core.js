// Peak Blocks rules as a pure state machine. The UI in puzzle-games.js drives it, tests play it directly,
// and a server can replay a run from {seed, log} to check the score.
import {emptyGrid,fits,placements,placeBlock,makeTray,bombGrid} from './puzzle-rules.js';
import {nextRandom} from './rng.js';

export const BLOCK_TOOLS=Object.freeze({bomb:3,undo:3,shuffle:3,hint:3});
// Scoring modelled on Block Blast. Placing a piece scores 1 per block. A clear scores 10 per cleared block, times a
// bonus for several lines at once (x3 for 2 lines, x6 for 3, x10 for 4, more beyond), times the combo: each clear in a
// streak adds 50%. The streak survives up to two placements without a clear; the third ends it. Emptying the board
// adds 300 on top.
export const BLOCK_SCORE=Object.freeze({cell:1,clearCell:10,lineMult:[0,1,3,6,10,15,20],comboStep:.5,comboGrace:3,perfect:300});
export function clearPoints(cells,lines,combo){const m=BLOCK_SCORE.lineMult[Math.min(lines,BLOCK_SCORE.lineMult.length-1)];return Math.round(cells*BLOCK_SCORE.clearCell*m*(1+BLOCK_SCORE.comboStep*Math.max(0,combo-1)));}
const clone=value=>structuredClone(value);

// Replay format. v1 dealt trays with no difficulty ramp and no near-clear assist; v2 adds both; v3 adds the
// milestone reward below. Runs started before each of those shipped keep their own v, so they go on being
// verified with the rules they were actually played on.
export const BLOCKS_REPLAY_VERSION=3;
// The tray generator has only two variants, and v3 deals exactly as v2 does. Capping it here keeps the
// generator's contract to the two values it knows, so bumping the replay version cannot silently re-deal.
const trayOpts=g=>({version:g.version===1?1:2,moves:g.state.moves,score:g.state.score});

// Milestone reward (v3). Every MILESTONE.every lines cleared in a run hands the player one extra use of a
// tool, rotating Bomb, then Undo, then Shuffle, so a long run keeps a way out of a board that blocks up.
export const BLOCK_MILESTONE=Object.freeze({every:25,tools:Object.freeze(['bomb','undo','shuffle'])});
// The level a run is on, from the lines it has cleared. Peak Blocks is endless and has no levels of its
// own, but players and testers talk about them, so the milestone is shown as one: level 1 from the first
// piece, level 2 once 25 lines are gone, and so on. Display only — nothing in the rules reads it.
//
// Two numbers come out of the same milestone and they differ by one on purpose:
//   blocksLevel(lines)   the level the player is ON    — starts at 1
//   levelsPassed(lines)  the levels they have PASSED   — starts at 0, and is what the achievement counts
// So the run that earns the first reward is on level 2 and has passed one level.
export const blocksLevel=lines=>levelsPassed(lines)+1;
export const levelsPassed=lines=>Math.floor(Math.max(0,Math.floor(Number(lines)||0))/BLOCK_MILESTONE.every);

// The nth milestone, counting from 1: which tool it gives and what the banner says. The banner names the
// level the player has just reached, which is the number the HUD is showing them.
export function milestoneReward(n){
  const tools=BLOCK_MILESTONE.tools,tool=tools[(n-1)%tools.length],lines=n*BLOCK_MILESTONE.every;
  return {milestone:n,lines,level:n+1,tool,
    label:`Level ${n+1}! Free ${tool[0].toUpperCase()+tool.slice(1)}`};
}

// How a clear should feel, as numbers. Pure, so the feel is covered by tests with no DOM at all.
// The shake grows with the combo and stops at its cap; levels is how many combo steps have a feel of
// their own, matching the clear sounds in game-audio.js. motion:false turns the shake off completely —
// a shaking screen is the first thing a player who asked for less motion does not want.
export const COMBO_FEEL=Object.freeze({base:3,step:2,max:9,ms:240,levels:5});
export function comboFeedback(out,{motion=true}={}){
  const lines=out?.lines||0;
  if(!lines)return {lines:0,combo:0,level:0,big:false,shake:0,ms:0,label:''};
  const combo=Math.max(1,Math.round(out.combo||1)),level=Math.min(combo,COMBO_FEEL.levels);
  const big=lines>=2||Boolean(out.perfect);
  // A single line with no combo behind it is a tap, not an event, so it gets no shake.
  const strength=combo>1||big?Math.min(COMBO_FEEL.max,COMBO_FEEL.base+(level-1)*COMBO_FEEL.step+(big?COMBO_FEEL.step:0)):0;
  return {lines,combo,level,big,shake:motion?strength:0,ms:motion?COMBO_FEEL.ms:0,label:combo>1?`COMBO x${combo}`:''};
}
// Which whole rows and columns a clear took out. placeBlock knows while it works and only hands back the
// cells, and a burst that fires along the lines needs the lines themselves.
export function clearedLines(cleared=[]){
  const rows=new Map(),cols=new Map();
  for(const [r,c] of cleared){rows.set(r,(rows.get(r)||0)+1);cols.set(c,(cols.get(c)||0)+1);}
  const whole=map=>[...map].filter(([,n])=>n===8).map(([i])=>i).sort((a,b)=>a-b);
  return {rows:whole(rows),cols:whole(cols)};
}
export function createBlocks(seed,version=BLOCKS_REPLAY_VERSION){
  const state={grid:emptyGrid(),tray:null,selected:0,score:0,lines:0,chain:0,sinceClear:0,bestChain:0,moves:0,rng:seed>>>0};
  // The rewarded count tracks the milestones this run has already paid out. It sits on the run rather
  // than in state, because Undo rewinds the lines but not the tools they bought: re-crossing a
  // milestone must not pay twice.
  const g={seed:seed>>>0,state,history:[],tools:{...BLOCK_TOOLS},ended:false,log:[],rewarded:0,version:version===1?1:version===2?2:3};
  // The generator state lives inside `state`, so Undo also rewinds it and replaying a move deals the same tray.
  state.tray=makeTray(state.grid,()=>nextRandom(state),trayOpts(g));
  return g;
}
export const anyFit=g=>g.state.tray.some(p=>p&&placements(g.state.grid,p.shape).length>0);
// The run ends when nothing fits and no tool that adds space is left. This runs after every action,
// not only after placing, so using the last Bomb or Shuffle (or an Undo) can't leave a stuck board.
function checkEnd(g){if(!g.ended&&!anyFit(g)&&!g.tools.bomb&&!g.tools.shuffle)g.ended=true;return g.ended;}
function remember(g){g.history.push(clone(g.state));if(g.history.length>BLOCK_TOOLS.undo)g.history.shift();}

export function blocksPlace(g,index,r,c){
  if(g.ended)return null;
  const s=g.state,p=s.tray[index];
  if(!p)return null;
  const out=placeBlock(s.grid,p.shape,r,c,p.color);
  if(!out)return null;
  remember(g);
  s.grid=out.grid;s.moves++;s.lines+=out.lines;
  // `chain` is the combo count shown in the HUD; `sinceClear` counts placements since the last clear.
  let bonus=0;out.perfect=false;
  if(out.lines){s.chain=s.chain>0&&(s.sinceClear??0)<BLOCK_SCORE.comboGrace?s.chain+1:1;s.sinceClear=0;s.bestChain=Math.max(s.bestChain||0,s.chain);
    bonus=clearPoints(out.cleared.length,out.lines,s.chain);if(s.grid.every(row=>row.every(v=>!v))){out.perfect=true;bonus+=BLOCK_SCORE.perfect;}}
  else{s.sinceClear=(s.sinceClear??0)+1;if(s.sinceClear>=BLOCK_SCORE.comboGrace)s.chain=0;}
  // Milestones are paid off the count of lines reached, so the only way to cross one twice is to clear
  // the lines twice; `rewarded` never goes back down. Nothing here touches the score.
  out.rewards=[];
  if(g.version>=3){
    const reached=Math.floor(s.lines/BLOCK_MILESTONE.every);
    while(g.rewarded<reached){const reward=milestoneReward(++g.rewarded);g.tools[reward.tool]++;out.rewards.push(reward);}
  }
  out.points=p.shape.length*BLOCK_SCORE.cell+bonus;out.clearPoints=bonus;out.combo=s.chain;
  s.score+=out.points;
  s.tray[index]=null;
  if(s.tray.every(x=>!x))s.tray=makeTray(s.grid,()=>nextRandom(s),trayOpts(g));
  s.selected=s.tray.findIndex(Boolean);
  g.log.push(['p',index,r,c]);
  checkEnd(g);
  return out;
}
export function blocksBomb(g,r,c){
  if(g.ended||!g.tools.bomb)return false;
  const s=g.state;
  const count=s.grid.flatMap((row,rr)=>row.filter((v,cc)=>v&&Math.abs(rr-r)<=1&&Math.abs(cc-c)<=1)).length;
  if(!count)return false;
  remember(g);s.grid=bombGrid(s.grid,r,c);g.tools.bomb--;
  g.log.push(['b',r,c]);checkEnd(g);return true;
}
export function blocksUndo(g){
  if(g.ended||!g.history.length||!g.tools.undo)return false;
  g.state=g.history.pop();g.tools.undo--;
  g.log.push(['u']);checkEnd(g);return true;
}
export function blocksShuffle(g){
  if(g.ended||!g.tools.shuffle)return false;
  remember(g);const s=g.state;
  s.tray=makeTray(s.grid,()=>nextRandom(s),trayOpts(g));s.selected=0;g.tools.shuffle--;
  g.log.push(['s']);checkEnd(g);return true;
}
export function blocksHint(g){
  if(g.ended||!g.tools.hint)return null;
  const s=g.state;let best=null;
  s.tray.forEach((p,i)=>{if(!p)return;for(const [r,c] of placements(s.grid,p.shape)){const out=placeBlock(s.grid,p.shape,r,c,p.color);if(!best||out.lines>best.lines)best={i,r,c,lines:out.lines,shape:p.shape};}});
  if(!best)return null;
  g.tools.hint--;s.selected=best.i;g.log.push(['h']);return best;
}
// What the assist banner says, and which tool buttons should call for attention. Kept pure and out of
// the UI so the wording and the suggested set are covered by tests with no DOM. `suggest` lists only
// the tools that can actually make room. Hint is left out on purpose: with nothing able to fit there is
// no placement for it to point at, so glowing it would send the player at the one button that cannot help.
export function blocksAssist(g,{bomb=false,ended=false}={}){
  if(bomb)return {mode:'bomb',title:'Bomb ready · clears 3 × 3',text:'Drag it onto the board, or tap a square. Tap Bomb again to cancel.',suggest:[]};
  if(ended||g.ended||anyFit(g))return {mode:null,title:'',text:'',suggest:[]};
  const suggest=['bomb','undo','shuffle'].filter(k=>g.tools[k]>0&&(k!=='undo'||g.history.length>0));
  const names=suggest.map(k=>k[0].toUpperCase()+k.slice(1)).join(', ').replace(/, ([^,]+)$/,' or $1');
  return {mode:'stuck',title:'No space left! Use a tool',text:names?`Tap ${names} below to make room.`:'No tools left.',suggest};
}
// Where a dragged piece is drawn and which square it would land on. Pure geometry, kept out of the
// drag handler so the feel is covered by tests with no browser. The piece is always centred horizontally
// on the pointer; `anchor` says how much of its height sits above the pointer, and `lift` then floats it
// further clear, measured in board cells.
//
// A finger has to be able to see the piece it is holding, so touch keeps the whole piece above the
// pointer (anchor 1) and lifts it clear as well. A cursor is a few pixels and hides nothing, so a mouse
// or a pen holds the piece in the middle of itself (anchor .5, no lift) — the piece is under the cursor,
// which is where a piece being dragged by a mouse belongs.
export const BLOCK_LIFT=Object.freeze({touch:1.8,mouse:0});
export const BLOCK_ANCHOR=Object.freeze({touch:1,mouse:.5});
// Which of those a pointer gets. Pen behaves like a mouse: it is precise and it does not sit on the piece.
export const dragGrip=pointerType=>pointerType==='touch'
  ?{lift:BLOCK_LIFT.touch,anchor:BLOCK_ANCHOR.touch}
  :{lift:BLOCK_LIFT.mouse,anchor:BLOCK_ANCHOR.mouse};
export function dragLanding({x,y,cols,rows,lift=0,anchor=1,cell,step,left:boardLeft,top:boardTop}){
  const width=cols*step-(step-cell),height=rows*step-(step-cell);
  const left=x-width/2,top=y-lift*cell-height*anchor;
  // Math.round hands back -0 just above the top-left corner; adding zero keeps the index a plain 0.
  const square=n=>Math.round(n)+0;
  return {left,top,width,height,r:square((top-boardTop)/step),c:square((left-boardLeft)/step)};
}
export function blocksResult(g){const s=g.state;return {score:s.score,lines:s.lines,moves:s.moves,bestCombo:s.bestChain||0,won:false,replay:{v:g.version,game:'blocks',seed:g.seed,log:g.log.map(x=>[...x])}};}

// Server side: rebuild a run from its seed and log. Any illegal step means the log was tampered with.
export function replayBlocks(replay){
  if(!replay||replay.game!=='blocks'||!Array.isArray(replay.log))throw new Error('Not a Peak Blocks replay');
  const version=replay.v===undefined?1:replay.v;
  if(![1,2,3].includes(version))throw new Error(`Unknown Peak Blocks replay version ${version}`);
  const g=createBlocks(replay.seed,version);
  for(const step of replay.log){
    const [kind,...a]=step;
    const ok=kind==='p'?blocksPlace(g,a[0],a[1],a[2]):kind==='b'?blocksBomb(g,a[0],a[1]):kind==='u'?blocksUndo(g):kind==='s'?blocksShuffle(g):kind==='h'?blocksHint(g):null;
    if(!ok)throw new Error(`Illegal step ${JSON.stringify(step)}`);
  }
  return blocksResult(g);
}
export {fits,placements};
