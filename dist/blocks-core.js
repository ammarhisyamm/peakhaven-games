// Peak Blocks rules as a pure state machine. The UI in puzzle-games.js drives it, tests play it directly,
// and a server can replay a run from {seed, log} to check the score.
import {emptyGrid,fits,placements,placeBlock,makeTray,bombGrid} from './puzzle-rules.js';
import {nextRandom} from './rng.js';

export const BLOCK_TOOLS=Object.freeze({bomb:3,undo:3,shuffle:3,hint:3});
const trayLevel=moves=>1+Math.floor(moves/12);
const clone=value=>structuredClone(value);

export function createBlocks(seed){
  const state={grid:emptyGrid(),tray:null,selected:0,score:0,lines:0,chain:0,moves:0,rng:seed>>>0};
  // The generator state lives inside `state`, so Undo also rewinds it and replaying a move deals the same tray.
  state.tray=makeTray(state.grid,()=>nextRandom(state),1);
  return {seed:seed>>>0,state,history:[],tools:{...BLOCK_TOOLS},ended:false,log:[]};
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
  s.grid=out.grid;s.moves++;s.chain=out.lines?s.chain+1:0;s.lines+=out.lines;
  s.score+=p.shape.length*10+out.lines*100*Math.max(1,s.chain);
  s.tray[index]=null;
  if(s.tray.every(x=>!x))s.tray=makeTray(s.grid,()=>nextRandom(s),trayLevel(s.moves));
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
  s.tray=makeTray(s.grid,()=>nextRandom(s),trayLevel(s.moves));s.selected=0;g.tools.shuffle--;
  g.log.push(['s']);checkEnd(g);return true;
}
export function blocksHint(g){
  if(g.ended||!g.tools.hint)return null;
  const s=g.state;let best=null;
  s.tray.forEach((p,i)=>{if(!p)return;for(const [r,c] of placements(s.grid,p.shape)){const out=placeBlock(s.grid,p.shape,r,c,p.color);if(!best||out.lines>best.lines)best={i,r,c,lines:out.lines,shape:p.shape};}});
  if(!best)return null;
  g.tools.hint--;s.selected=best.i;g.log.push(['h']);return best;
}
export function blocksResult(g){const s=g.state;return {score:s.score,lines:s.lines,moves:s.moves,won:false,replay:{v:1,game:'blocks',seed:g.seed,log:g.log.map(x=>[...x])}};}

// Server side: rebuild a run from its seed and log. Any illegal step means the log was tampered with.
export function replayBlocks(replay){
  if(!replay||replay.game!=='blocks'||!Array.isArray(replay.log))throw new Error('Not a Peak Blocks replay');
  const g=createBlocks(replay.seed);
  for(const step of replay.log){
    const [kind,...a]=step;
    const ok=kind==='p'?blocksPlace(g,a[0],a[1],a[2]):kind==='b'?blocksBomb(g,a[0],a[1]):kind==='u'?blocksUndo(g):kind==='s'?blocksShuffle(g):kind==='h'?blocksHint(g):null;
    if(!ok)throw new Error(`Illegal step ${JSON.stringify(step)}`);
  }
  return blocksResult(g);
}
export {fits,placements};
