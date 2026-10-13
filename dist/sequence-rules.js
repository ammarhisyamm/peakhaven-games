export const SEQUENCE_SIZE=7;
export const SEQUENCE_MOVES=25;
export const SEQUENCE_TYPES=5;
// Points needed to clear a level. Up to level 50 it is the original 350 + 150 per level. Colours stop at 7
// from level 16, so the score a good player can reach in 25 moves stops growing too; past level 50 the
// target eases (same slope at the join) toward a ceiling of 8650, where a greedy bot clears about 62% of
// boards, instead of rising 150 a level for ever until nobody can win. Rounded to 50, the scoring unit.
export const SEQUENCE_TARGET_KNEE=50,SEQUENCE_TARGET_CAP=8650;
export function sequenceTarget(level){
  const l=Math.max(1,level);if(l<=SEQUENCE_TARGET_KNEE)return 350+150*l;
  const atKnee=350+150*SEQUENCE_TARGET_KNEE,room=SEQUENCE_TARGET_CAP-atKnee;
  return Math.round((SEQUENCE_TARGET_CAP-room*Math.exp(-(l-SEQUENCE_TARGET_KNEE)*150/room))/50)*50;
}
// Colours in play: 4 at level 1, one more every 5 levels, capped at 7 from level 16.
export const sequencePalette=level=>Math.min(7,4+Math.floor((Math.max(1,level)-1)/5));

export function sequenceMatches(board,size=SEQUENCE_SIZE){
  const matches=new Set();
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const value=board[row*size+col];if(value<0)continue;
    let end=col+1;while(end<size&&board[row*size+end]===value)end++;
    if(end-col>=3)for(let c=col;c<end;c++)matches.add(row*size+c);
    end=row+1;while(end<size&&board[end*size+col]===value)end++;
    if(end-row>=3)for(let r=row;r<end;r++)matches.add(r*size+col);
  }
  return matches;
}

export function sequenceExchange(board,a,b,size=SEQUENCE_SIZE){
  if(!Number.isInteger(a)||!Number.isInteger(b))return null;
  const ar=Math.floor(a/size),ac=a%size,br=Math.floor(b/size),bc=b%size;
  if(a<0||b<0||a>=size*size||b>=size*size||Math.abs(ar-br)+Math.abs(ac-bc)!==1)return null;
  const next=board.slice();[next[a],next[b]]=[next[b],next[a]];
  return next;
}

export function sequenceSwap(board,a,b,size=SEQUENCE_SIZE){
  const next=sequenceExchange(board,a,b,size);
  return next&&sequenceMatches(next,size).size?next:null;
}

export function hasSequenceMove(board,size=SEQUENCE_SIZE){
  for(let index=0;index<board.length;index++){
    const row=Math.floor(index/size),col=index%size;
    if(col<size-1&&sequenceSwap(board,index,index+1,size))return true;
    if(row<size-1&&sequenceSwap(board,index,index+size,size))return true;
  }
  return false;
}

export function createSequenceBoard(level=1,rng=Math.random,size=SEQUENCE_SIZE){
  const palette=sequencePalette(level);
  const board=Array(size*size);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const choices=Array.from({length:palette},(_,n)=>n).filter(value=>!(col>=2&&board[row*size+col-1]===value&&board[row*size+col-2]===value)&&!(row>=2&&board[(row-1)*size+col]===value&&board[(row-2)*size+col]===value));
    board[row*size+col]=choices[Math.floor(rng()*choices.length)];
  }
  return hasSequenceMove(board,size)?board:createSequenceBoardFallback(palette,size);
}

function createSequenceBoardFallback(palette,size){
  // This repeating pattern is match-free and always has a legal horizontal swap.
  return Array.from({length:size*size},(_,index)=>{
    const row=Math.floor(index/size),col=index%size;
    return (col+Math.floor(row/2))%palette;
  });
}

export function settleSequence(board,rng=Math.random,size=SEQUENCE_SIZE,palette=SEQUENCE_TYPES){
  const next=board.slice();
  for(let col=0;col<size;col++){
    let write=size-1;
    for(let row=size-1;row>=0;row--)if(next[row*size+col]>=0){next[write*size+col]=next[row*size+col];write--;}
    for(let row=write;row>=0;row--)next[row*size+col]=Math.floor(rng()*palette);
  }
  return next;
}

// One whole cascade after a swap, exactly as SequenceEngine plays it out: each wave of matches scores
// size*50*(1+chain), clears, falls and refills from `rng`; it stops early once `score` reaches `target`
// (the engine ends the level there). Returns the settled board, the points gained and the chain length.
export function sequenceCascade(board,rng=Math.random,palette=SEQUENCE_TYPES,score=0,target=Infinity,size=SEQUENCE_SIZE){
  let next=board,gained=0,chain=0;
  for(;;){
    const matches=sequenceMatches(next,size);if(!matches.size)break;
    gained+=matches.size*50*(1+chain);chain++;
    next=settleSequence(next.map((v,i)=>matches.has(i)?-1:v),rng,size,palette);
    if(score+gained>=target)break;
  }
  return {board:next,gained,chain};
}
