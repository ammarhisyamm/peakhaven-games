import {createSequenceBoard,sequenceExchange,sequenceMatches,sequencePalette,sequenceTarget} from './sequence-rules.js';

export const SEQUENCE_RULES_VERSION=2;
export const CRYSTAL_NAMES=['blue diamonds','aqua drops','gold stars','purple crystals','green crystals','pink crystals','white crystals'];
const patterns=[
 [16,18,30,32,22,26,10,38,24,8,40,12], // pockets
 [10,17,24,31,38,22,23,25,26,16,32,18], // cross
 [9,11,15,19,29,33,37,39,23,25,17,31], // diamond
 [8,12,36,40,16,18,30,32,22,26,10,38], // corners
];
export function sequenceLevel(level=1){
 const n=Number.isFinite(level)?Math.max(1,Math.floor(level)):1,chapter=Math.floor((n-1)/10),pattern=patterns[(n-3+patterns.length*10)%patterns.length];
 const ice=Array(49).fill(0),locks=Array(49).fill(false);
 const count=n<3?0:Math.min(8,4+Math.floor((n-3)/4)),layers=n<5?1:2;
 for(const i of pattern.slice(0,count))ice[i]=layers;
 // Keep the upper two rows open: there is always room for a legal rescue swap.
 const traps=n<7?0:Math.min(4,2+Math.floor((n-7)/8));
 for(const i of pattern.filter(i=>i>=14).slice().reverse().slice(0,traps))locks[i]=true;
 const collect=n<9?null:{type:(Math.floor((n-9)/3)+chapter)%sequencePalette(n),count:Math.min(18,9+Math.floor((n-9)/3))};
 return {level:n,target:Math.min(4500,sequenceTarget(n)),palette:sequencePalette(n),ice,locks,collect};
}
export function createSequenceProgress(config){return {ice:config.ice.slice(),locks:config.locks.slice(),collected:0};}
export function sequenceGoals(config,state){
 const goals=[];
 const iceTotal=config.ice.reduce((a,b)=>a+b,0),iceLeft=state.ice.reduce((a,b)=>a+b,0),lockTotal=config.locks.filter(Boolean).length,lockLeft=state.locks.filter(Boolean).length;
 if(iceTotal)goals.push({kind:'ice',label:'Ice layers',done:iceTotal-iceLeft,total:iceTotal,left:iceLeft});
 if(lockTotal)goals.push({kind:'lock',label:'Traps',done:lockTotal-lockLeft,total:lockTotal,left:lockLeft});
 if(config.collect)goals.push({kind:'collect',type:config.collect.type,label:CRYSTAL_NAMES[config.collect.type],done:Math.min(config.collect.count,state.collected),total:config.collect.count,left:Math.max(0,config.collect.count-state.collected)});
 return goals;
}
export const sequenceComplete=(score,config,state)=>score>=config.target&&sequenceGoals(config,state).every(g=>g.left===0);
export function sequenceBrief(level){
 const c=sequenceLevel(level),parts=[`Reach ${c.target.toLocaleString('en-AU')} points`];
 if(c.ice.some(Boolean))parts.push(c.ice.includes(2)?'break the two-layer ice':'break the ice');
 if(c.locks.some(Boolean))parts.push('free the trapped crystals');
 if(c.collect)parts.push(`collect ${c.collect.count} ${CRYSTAL_NAMES[c.collect.type]}`);
 return `${parts.join(' · ')}.${c.ice.some(Boolean)?' Match on or beside ice and traps.':''} 25 moves.`;
}
// Each cascade wave hits a tile at most once, even when several neighbouring matches touch it.
export function applySequenceWave(config,state,board,matches){
 const hit=new Set(matches);
 for(const i of matches){if(i%7)hit.add(i-1);if(i%7<6)hit.add(i+1);if(i>=7)hit.add(i-7);if(i<42)hit.add(i+7);}
 const next={ice:state.ice.slice(),locks:state.locks.slice(),collected:state.collected};
 for(const i of hit){next.ice[i]=Math.max(0,next.ice[i]-1);next.locks[i]=false;}
 if(config.collect)for(const i of matches)if(board[i]===config.collect.type)next.collected++;
 return next;
}
export function progressionExchange(board,a,b,state){return state.locks[a]||state.locks[b]?null:sequenceExchange(board,a,b);}
export function progressionMove(board,state){
 for(let a=0;a<49;a++)for(const b of [a%7<6?a+1:-1,a+7]){
  if(b<0||b>48)continue;const next=progressionExchange(board,a,b,state);if(next&&sequenceMatches(next).size)return [a,b];
 }
 return null;
}
// Trapped crystals anchor their column. Gravity/refill operates independently above and below each trap.
export function settleProgression(board,rng,palette,state){
 const next=board.slice(),falls=new Map();
 for(let col=0;col<7;col++){
  let bottom=6;
  for(let boundary=6;boundary>=-1;boundary--){
   if(boundary>=0&&!state.locks[boundary*7+col])continue;
   let write=bottom;
   for(let row=bottom;row>boundary;row--)if(board[row*7+col]>=0){next[write*7+col]=board[row*7+col];falls.set(write*7+col,row-write);write--;}
   const depth=write-boundary;
   for(let row=write;row>boundary;row--){next[row*7+col]=Math.floor(rng()*palette);falls.set(row*7+col,-depth);}
   bottom=boundary-1;
  }
 }
 return {board:next,falls};
}
export function createProgressionBoard(config,rng,state,previous=null){
 for(let attempt=0;attempt<64;attempt++){
  const board=createSequenceBoard(config.level,rng);
  if(previous)for(let i=0;i<49;i++)if(state.locks[i])board[i]=previous[i];
  if(!sequenceMatches(board).size&&progressionMove(board,state))return board;
 }
 // Bounded deterministic fallback: keep trapped pieces, refill the rest without pre-made matches,
 // and reserve an open 2x3 corner for one guaranteed swap. It never removes an objective.
 const board=Array(49).fill(-1);
 for(let i=0;i<49;i++)if(state.locks[i])board[i]=previous?.[i]??i%config.palette;
 const fixed=new Set([0,1,2,7,8,9]);[0,1,0,2,0,3].forEach((v,k)=>board[[0,1,2,7,8,9][k]]=v);
 for(let i=0;i<49;i++)if(!fixed.has(i)&&!state.locks[i]){
  const choices=Array.from({length:config.palette},(_,v)=>v).filter(v=>{board[i]=v;return !sequenceMatches(board).has(i);});
  board[i]=choices[Math.floor(rng()*choices.length)];
 }else if(board[i]<0)board[i]=i%config.palette;
 return board;
}
