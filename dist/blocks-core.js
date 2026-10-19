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

// Replay format. v1 dealt trays with no difficulty ramp and no near-clear assist; v2 adds both. Runs started
// before the ramp shipped still carry v:1, so they keep being verified with the generator they were played on.
export const BLOCKS_REPLAY_VERSION=2;
const trayOpts=g=>({version:g.version,moves:g.state.moves,score:g.state.score});
export function createBlocks(seed,version=BLOCKS_REPLAY_VERSION){
  const state={grid:emptyGrid(),tray:null,selected:0,score:0,lines:0,chain:0,sinceClear:0,bestChain:0,moves:0,rng:seed>>>0};
  const g={seed:seed>>>0,state,history:[],tools:{...BLOCK_TOOLS},ended:false,log:[],version:version===1?1:2};
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
// drag handler so the feel is covered by tests with no browser. `lift` is how far the BOTTOM of the
// piece floats above the pointer, measured in board cells, so a tall piece rides as high as a short
// one instead of further; the piece is centred horizontally on the pointer.
export const BLOCK_LIFT=Object.freeze({touch:1.8,mouse:.8});
export function dragLanding({x,y,cols,rows,lift=0,cell,step,left:boardLeft,top:boardTop}){
  const width=cols*step-(step-cell),height=rows*step-(step-cell);
  const left=x-width/2,top=y-lift*cell-height;
  // Math.round hands back -0 just above the top-left corner; adding zero keeps the index a plain 0.
  const square=n=>Math.round(n)+0;
  return {left,top,width,height,r:square((top-boardTop)/step),c:square((left-boardLeft)/step)};
}
export function blocksResult(g){const s=g.state;return {score:s.score,lines:s.lines,moves:s.moves,bestCombo:s.bestChain||0,won:false,replay:{v:g.version,game:'blocks',seed:g.seed,log:g.log.map(x=>[...x])}};}

// Server side: rebuild a run from its seed and log. Any illegal step means the log was tampered with.
export function replayBlocks(replay){
  if(!replay||replay.game!=='blocks'||!Array.isArray(replay.log))throw new Error('Not a Peak Blocks replay');
  const version=replay.v===undefined?1:replay.v;
  if(version!==1&&version!==2)throw new Error(`Unknown Peak Blocks replay version ${version}`);
  const g=createBlocks(replay.seed,version);
  for(const step of replay.log){
    const [kind,...a]=step;
    const ok=kind==='p'?blocksPlace(g,a[0],a[1],a[2]):kind==='b'?blocksBomb(g,a[0],a[1]):kind==='u'?blocksUndo(g):kind==='s'?blocksShuffle(g):kind==='h'?blocksHint(g):null;
    if(!ok)throw new Error(`Illegal step ${JSON.stringify(step)}`);
  }
  return blocksResult(g);
}
export {fits,placements};
