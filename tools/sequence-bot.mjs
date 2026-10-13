// Sequence bots and a headless, pure-rules playthrough that draws from the generator in exactly the
// engine's order (opening board, each refill, each reshuffle). Used by the tests and by the balance script.
import {createSequenceBoard,hasSequenceMove,sequenceMatches,sequenceExchange,sequenceCascade,sequencePalette,sequenceTarget,SEQUENCE_MOVES,SEQUENCE_SIZE} from '../dist/sequence-rules.js';
import {createRandom,SIM_STEP} from '../dist/rng.js';

const N=SEQUENCE_SIZE;
// Every adjacent pair once, as [from,to].
export const SEQUENCE_PAIRS=[];
for(let i=0;i<N*N;i++){if(i%N<N-1)SEQUENCE_PAIRS.push([i,i+1]);if(i+N<N*N)SEQUENCE_PAIRS.push([i,i+N]);}

export function legalSwaps(board){return SEQUENCE_PAIRS.filter(([a,b])=>sequenceMatches(sequenceExchange(board,a,b)).size>0);}

// The points a swap is sure to earn: the cascade among crystals already on the board, with every refill
// treated as unknown (-2 never matches). An honest player can see this much; the refills are luck.
export function knownCascade(board){
  let next=board,gained=0,chain=0;
  for(;;){
    const matches=sequenceMatches(next);if(!matches.size)break;
    gained+=matches.size*50*(1+chain);chain++;
    const cleared=next.map((v,i)=>matches.has(i)?-1:v);next=cleared.slice();
    for(let col=0;col<N;col++){let write=N-1;
      for(let row=N-1;row>=0;row--)if(cleared[row*N+col]!==-1){next[write*N+col]=cleared[row*N+col];write--;}
      for(let row=write;row>=0;row--)next[row*N+col]=-2;}
  }
  return {gained,chain,board:next};
}

// Naive: the swap that clears the most crystals right now, first found on ties. A weak-player reference.
export function plainMove(board){
  let best=null,bestSize=0;
  for(const [a,b] of SEQUENCE_PAIRS){const size=sequenceMatches(sequenceExchange(board,a,b)).size;if(size>bestSize){bestSize=size;best=[a,b];}}
  return best;
}

// Greedy: the swap with the most guaranteed points; ties go to the swap lower on the board, which shakes up
// more crystals and so tends to set off more chains.
export function greedyMove(board){
  let best=null,bestValue=-1;
  for(const [a,b] of SEQUENCE_PAIRS){const next=sequenceExchange(board,a,b);if(!sequenceMatches(next).size)continue;
    const value=knownCascade(next).gained+Math.max(Math.floor(a/N),Math.floor(b/N));
    if(value>bestValue){bestValue=value;best=[a,b];}}
  return best;
}

// Greedy with a one-ply look at what the known board leaves behind: points now, plus the best guaranteed
// follow-up on the settled (unknown-refilled) board.
export function lookaheadMove(board){
  let best=null,bestValue=-1;
  for(const [a,b] of SEQUENCE_PAIRS){const next=sequenceExchange(board,a,b);if(!sequenceMatches(next).size)continue;
    const now=knownCascade(next);let follow=0;
    for(const [c,d] of SEQUENCE_PAIRS){const after=sequenceExchange(now.board,c,d);if(after[c]<0||after[d]<0)continue;const m=sequenceMatches(after);if(m.size){const g=knownCascade(after).gained;if(g>follow)follow=g;}}
    const value=now.gained+.5*follow+Math.max(Math.floor(a/N),Math.floor(b/N));
    if(value>bestValue){bestValue=value;best=[a,b];}}
  return best;
}

// Random: any legal swap, or now and then a dud neighbour swap (which costs no move).
export function randomMove(board,rand){
  if(rand()<.2){const pair=SEQUENCE_PAIRS[Math.floor(rand()*SEQUENCE_PAIRS.length)];return pair;}
  const legal=legalSwaps(board);return legal[Math.floor(rand()*legal.length)];
}

// A whole level with the pure rules. `pick(board)` returns [from,to]. Returns the result and the swap log.
export function playSequence({level=1,seed=1,pick=greedyMove,target=sequenceTarget(level)}={}){
  const rng=createRandom(seed),palette=sequencePalette(level);
  let board=createSequenceBoard(level,rng),score=0,moves=SEQUENCE_MOVES,reshuffles=0;const log=[];
  while(moves>0&&score<target){
    const [a,b]=pick(board);log.push([a,b]);
    const next=sequenceExchange(board,a,b);if(!sequenceMatches(next).size)continue;
    moves--;const out=sequenceCascade(next,rng,palette,score,target);score+=out.gained;board=out.board;
    if(score>=target||moves<=0)break;
    if(!hasSequenceMove(board)){board=createSequenceBoard(level,rng);reshuffles++;}
  }
  return {won:score>=target,score,moves:SEQUENCE_MOVES-moves,log,reshuffles,board};
}

// Plays a live SequenceEngine on its fixed step: whenever the board is idle, waits `think(e)` ticks and
// then swaps `pick(board)`. `onStep(e)` runs after every step. Returns the ticks used.
export function driveSequence(e,pick,{think=()=>0,onStep,maxTicks=120*60*30,step=SIM_STEP}={}){
  let wait=null;
  while(!e.ended&&e.ticks<maxTicks){
    if(!e.pending&&!e.paused){wait??=think(e);if(wait<=0){wait=null;const [a,b]=pick(e.board);e.choose(a,b);}else wait--;}
    e.step(step);onStep?.(e);
  }
  return e.ticks;
}
