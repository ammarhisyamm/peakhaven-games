export const SEQUENCE_SIZE=7;
export const SEQUENCE_MOVES=25;
export const SEQUENCE_TYPES=5;
export const sequenceTarget=level=>350+Math.max(1,level)*150;

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

export function sequenceSwap(board,a,b,size=SEQUENCE_SIZE){
  const ar=Math.floor(a/size),ac=a%size,br=Math.floor(b/size),bc=b%size;
  if(a<0||b<0||a>=size*size||b>=size*size||Math.abs(ar-br)+Math.abs(ac-bc)!==1)return null;
  const next=board.slice();[next[a],next[b]]=[next[b],next[a]];
  return sequenceMatches(next,size).size?next:null;
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
  const palette=Math.min(7,4+Math.floor((Math.max(1,level)-1)/5));
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
