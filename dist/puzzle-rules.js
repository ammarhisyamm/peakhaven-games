// Pure rules shared by pointer, touch and keyboard play.
// Peak Blocks pieces, modelled on Block Blast: no rotation, so every orientation is its own piece, and each family
// has its own colour. Weights set how often a piece is dealt (bigger awkward pieces a little rarer).
const cells=rows=>rows.flatMap((row,y)=>[...row].flatMap((ch,x)=>ch==='#'?[[x,y]]:[]));
const family=(name,color,weight,...shapes)=>shapes.map(rows=>({name,color,weight,shape:cells(rows)}));
export const PIECES=[
  ...family('dot',3,2,['#']),
  ...family('line2',1,3,['##'],['#','#']),
  ...family('line3',1,3,['###'],['#','#','#']),
  ...family('line4',1,2.5,['####'],['#','#','#','#']),
  ...family('line5',1,1.8,['#####'],['#','#','#','#','#']),
  ...family('square2',3,4,['##','##']),
  ...family('square3',3,1.6,['###','###','###']),
  ...family('rect',8,2,['###','###'],['##','##','##']),
  ...family('corner3',2,1.8,['##','#.'],['##','.#'],['#.','##'],['.#','##']),
  ...family('l4',9,1.1,['#.','#.','##'],['.#','.#','##'],['##','#.','#.'],['##','.#','.#'],['###','#..'],['###','..#'],['#..','###'],['..#','###']),
  ...family('corner5',7,1,['###','#..','#..'],['###','..#','..#'],['#..','#..','###'],['..#','..#','###']),
  ...family('t',8,1.3,['###','.#.'],['.#.','###'],['#.','##','#.'],['.#','##','.#']),
  ...family('sz',7,1.1,['##.','.##'],['.##','##.'],['#.','##','.#'],['.#','##','#.']),
];
// Kept for older callers: the bare shapes, with the 1-cell and 2-cell pieces first.
export const SHAPES=PIECES.map(p=>p.shape);
export const emptyGrid=()=>Array.from({length:8},()=>Array(8).fill(0));
export function fits(grid,shape,row,col){return shape.every(([x,y])=>row+y>=0&&col+x>=0&&row+y<8&&col+x<8&&!grid[row+y][col+x]);}
export function placements(grid,shape){const list=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(fits(grid,shape,r,c))list.push([r,c]);return list;}
export function placeBlock(grid,shape,row,col,color=1){if(!fits(grid,shape,row,col))return null;const next=grid.map(r=>[...r]);for(const [x,y]of shape)next[row+y][col+x]=color;const rows=[],cols=[];for(let i=0;i<8;i++){if(next[i].every(Boolean))rows.push(i);if(next.every(r=>r[i]))cols.push(i);}const cleared=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(rows.includes(r)||cols.includes(c)){cleared.push([r,c]);next[r][c]=0;}return {grid:next,lines:rows.length+cols.length,cleared};}
// How the deal changes over a run. `phase` eases from 0 to 1 across the first RAMP_MOVES placements, so the tray
// drifts from small forgiving pieces to the awkward ones without a step the player can feel.
export const RAMP_MOVES=48;
// How much each family is favoured at the start of a run and at the far end of the ramp. Early trays lean on the
// small forgiving shapes; late trays bring the awkward ones out. Everything between is eased, never stepped.
const EARLY_MULT={dot:17,line2:11,line3:4,square2:3,corner3:2.4,line4:.4,rect:.35,square3:.07,line5:.09,corner5:.09,l4:.1,t:.1,sz:.1};
const LATE_MULT={dot:.7,line2:.9,line3:1,square2:1,corner3:1.1,line4:1.3,rect:1.25,square3:1.9,line5:1.8,corner5:1.9,l4:1.8,t:1.7,sz:1.8};
const smooth=t=>t*t*(3-2*t);
export const trayPhase=(moves=0)=>smooth(Math.min(1,Math.max(0,moves/RAMP_MOVES)));
// Near-clear assist: the chance that one slot is a piece which completes a line somewhere on the board right now.
const ASSIST_EARLY=.6,ASSIST_LATE=.2;
export const assistChance=phase=>ASSIST_EARLY+(ASSIST_LATE-ASSIST_EARLY)*phase;
function rampWeight(piece,phase){const a=EARLY_MULT[piece.name]??1,b=LATE_MULT[piece.name]??1;return piece.weight*(a+(b-a)*phase);}
const weightedPick=(list,weights,rng)=>{const total=weights.reduce((sum,w)=>sum+w,0);let x=rng()*total;for(let i=0;i<list.length;i++){x-=weights[i];if(x<0)return list[i];}return list.at(-1);};
// Does this piece finish a row or column somewhere, as the board stands? Counted from row and column tallies rather
// than by placing and clearing, because the assist asks this of every piece on every deal.
const rowFill=new Int8Array(8),colFill=new Int8Array(8),rowAdd=new Int8Array(8),colAdd=new Int8Array(8);
function tally(grid){rowFill.fill(0);colFill.fill(0);for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(grid[r][c]){rowFill[r]++;colFill[c]++;}}
function completesLine(grid,shape){
  for(const [row,col]of placements(grid,shape)){
    rowAdd.fill(0);colAdd.fill(0);
    for(const [x,y]of shape){rowAdd[row+y]++;colAdd[col+x]++;}
    for(let i=0;i<8;i++)if((rowAdd[i]&&rowFill[i]+rowAdd[i]===8)||(colAdd[i]&&colFill[i]+colAdd[i]===8))return true;
  }
  return false;
}
// A line needs 8 cells and the widest piece spans 5, so nothing can be completed until some row or column holds 3.
function assistCandidates(grid){
  tally(grid);
  let ready=false;for(let i=0;i<8&&!ready;i++)if(rowFill[i]>=3||colFill[i]>=3)ready=true;
  return ready?PIECES.filter(p=>completesLine(grid,p.shape)):[];
}
// Three pieces, weighted at random like Block Blast's deal. A tray is never dead on arrival: if none of the three
// fits, the first is swapped for a piece that does. `opts` takes {version,moves}; a number is the old `level`
// argument, kept so v1 replays and older callers deal exactly what they always did.
export function makeTray(grid,rng=Math.random,opts=1){
  const o=opts&&typeof opts==='object'?opts:{};
  const phase=o.version===2?trayPhase(o.moves||0):null;
  const weights=phase===null?PIECES.map(p=>p.weight):PIECES.map(p=>rampWeight(p,phase));
  const pick=(list=PIECES,ws=weights)=>weightedPick(list,ws,rng);
  const fitsNow=p=>placements(grid,p.shape).length>0,full=grid.flat().filter(Boolean).length/64;
  // On a crowded board (over 45% full) a piece that can't go anywhere gets one redraw, the gentle help players feel
  // in Block Blast when the board gets tight.
  const tray=[pick(),pick(),pick()].map(p=>full>.45&&!fitsNow(p)?pick():p);
  // One slot becomes a piece that finishes a line right now, often early and rarely late. The roll happens on every
  // v2 deal so the generator consumes the same randomness either way and replays stay in step.
  if(phase!==null&&rng()<assistChance(phase)){
    const helpers=assistCandidates(grid);
    if(helpers.length)tray[Math.floor(rng()*3)]=pick(helpers,helpers.map(p=>rampWeight(p,phase)));
  }
  if(!tray.some(fitsNow)){const fitting=PIECES.filter(fitsNow);if(fitting.length)tray[0]=pick(fitting,fitting.map(p=>phase===null?p.weight:rampWeight(p,phase)));}
  return tray.map(p=>({shape:p.shape,color:p.color}));
}

export function bombGrid(grid,row,col){return grid.map((line,r)=>line.map((v,c)=>Math.abs(r-row)<=1&&Math.abs(c-col)<=1?0:v));}
export function tileRows(level=1){return 5+Math.floor(Math.max(0,level-20)/5);}
export function tileLayout(level=1){const tiles=[];for(let y=0;y<4;y++)for(let x=0;x<6;x++)tiles.push({id:tiles.length,x,y,z:0});for(let y=1;y<3;y++)for(let x=1;x<5;x++)tiles.push({id:tiles.length,x:x+.15,y:y-.15,z:1});for(let x=2;x<4;x++)tiles.push({id:tiles.length,x:x+.3,y:1.35,z:2});if(level>=4)for(let x=0;x<6;x++)tiles.push({id:tiles.length,x,y:4,z:0});if(level>=8){for(let x=1;x<5;x++)for(let y=0;y<2;y++)tiles.push({id:tiles.length,x:x+.15,y:2.85+y*.25,z:1});for(let x=2;x<4;x++)tiles.push({id:tiles.length,x:x+.3,y:2.35,z:2});}if(level>=15)for(let x=2;x<4;x++)tiles.push({id:tiles.length,x:x+.45,y:1.65,z:3});const extraRows=tileRows(level)-5;for(let row=0;row<extraRows;row++)for(let x=0;x<6;x++)tiles.push({id:tiles.length,x,y:5+row,z:0});return tiles;}
export function freeTile(tile,tiles){if(!tiles.some(t=>t.id===tile.id))return false;const covered=tiles.some(t=>t.z>tile.z&&Math.abs(t.x-tile.x)<.98&&Math.abs(t.y-tile.y)<.98);if(covered)return false;const adjacent=tiles.filter(t=>t.z===tile.z&&Math.abs(t.y-tile.y)<.1);return !adjacent.some(t=>Math.abs(t.x-(tile.x-1))<.1)||!adjacent.some(t=>Math.abs(t.x-(tile.x+1))<.1);}
// Assign matching pairs in a legal removal order, so every fresh/shuffled board is solvable.
export function dealTiles(layout=tileLayout(),rng=Math.random,kinds=6){const seen=new Set();function order(remaining){if(!remaining.length)return [];const key=remaining.map(t=>t.id).join(',');if(seen.has(key))return null;seen.add(key);const free=remaining.filter(t=>freeTile(t,remaining)),pairs=[];for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++)pairs.push([free[i],free[j]]);for(let i=pairs.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[pairs[i],pairs[j]]=[pairs[j],pairs[i]];}for(const [a,b]of pairs){const tail=order(remaining.filter(t=>t.id!==a.id&&t.id!==b.id));if(tail)return [[a,b],...tail];}return null;}const sequence=order(layout);if(!sequence)throw new Error('Layout is unsolvable');return sequence.flatMap(([a,b])=>{const kind=Math.floor(rng()*kinds);return [{...a,kind},{...b,kind}];}).sort((a,b)=>a.z-b.z||a.id-b.id);}
export function matchTiles(tiles,aId,bId){const a=tiles.find(t=>t.id===aId),b=tiles.find(t=>t.id===bId);return a&&b&&a.id!==b.id&&a.kind===b.kind&&freeTile(a,tiles)&&freeTile(b,tiles)?tiles.filter(t=>t.id!==aId&&t.id!==bId):null;}
export function tileHint(tiles){const seen=new Set();let visits=0;function solve(current){if(!current.length)return [];const key=current.map(t=>t.id).sort((a,b)=>a-b).join(',');if(seen.has(key)||visits++>20000)return null;seen.add(key);const free=current.filter(t=>freeTile(t,current));for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++)if(free[i].kind===free[j].kind){const next=matchTiles(current,free[i].id,free[j].id),tail=solve(next);if(tail)return [[free[i].id,free[j].id],...tail];}return null;}return solve(tiles)?.[0]||null;}

export function blockLevelGrid(level=1,rng=Math.random){const grid=emptyGrid();for(const [r,c]of [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[3,1],[4,1],[5,1],[5,2],[4,5],[4,6],[6,4]])grid[r][c]=1+(r+c)%3;const spaces=[];for(let r=1;r<8;r++)for(let c=0;c<6;c++)if(!grid[r][c])spaces.push([r,c]);for(let i=0;i<Math.min(18,Math.floor((level-1)/2));i++){const index=Math.floor(rng()*spaces.length),[r,c]=spaces.splice(index,1)[0];grid[r][c]=1+(r+c)%3;}return grid;}
