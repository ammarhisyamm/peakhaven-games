// Peak Blocks drag feel. The piece you hold is the piece that lands: board-sized, centred on the
// pointer and floating clear of it, with the landing square matching where it is drawn. The geometry
// lives in blocks-core so all of that can be checked without a browser, and the engine is untouched:
// the last test plays a run through pointer coordinates and replays it to the same score.
import test from 'node:test';
import assert from 'node:assert/strict';
const {dragLanding,BLOCK_LIFT,createBlocks,blocksPlace,blocksResult,replayBlocks}=await import('../dist/blocks-core.js');
const {SHAPES,placements}=await import('../dist/puzzle-rules.js');

// A board like a 390px-wide phone: 8 columns of 38.25px with a 4px gap.
const BOARD={cell:38.25,step:42.25,left:16,top:180};
const size=shape=>({cols:Math.max(...shape.map(s=>s[0]))+1,rows:Math.max(...shape.map(s=>s[1]))+1});
// The pointer position that should drop a piece's top-left corner on cell (r,c).
const aim=(shape,r,c,lift,board=BOARD)=>{
 const {cols,rows}=size(shape),width=cols*board.step-(board.step-board.cell),height=rows*board.step-(board.step-board.cell);
 return {x:board.left+c*board.step+width/2,y:board.top+r*board.step+height+lift*board.cell};
};
const land=(shape,point,lift,board=BOARD)=>dragLanding({...point,...size(shape),lift,...board});

test('The lift values match the brief: a finger clears the whole piece, a cursor just clears the art',()=>{
 assert.ok(BLOCK_LIFT.touch>=1.5&&BLOCK_LIFT.touch<=2,`touch lift ${BLOCK_LIFT.touch} outside 1.5-2 cells`);
 assert.ok(BLOCK_LIFT.mouse>=.5&&BLOCK_LIFT.mouse<=1,`mouse lift ${BLOCK_LIFT.mouse} outside 0.5-1 cells`);
 assert.ok(BLOCK_LIFT.mouse<BLOCK_LIFT.touch,'a cursor should sit closer to the piece than a thumb');
});

test('The piece is centred on the pointer and floats above it, never under it',()=>{
 for(const lift of [BLOCK_LIFT.touch,BLOCK_LIFT.mouse])for(const shape of SHAPES){
  const box=land(shape,{x:200,y:500},lift);
  assert.equal(Math.round((box.left+box.width/2)*100),200*100,'piece not centred on the pointer');
  const gap=500-(box.top+box.height);
  assert.ok(gap>0,'the pointer is sitting on the piece');
  assert.equal(Math.round(gap*1000),Math.round(lift*BOARD.cell*1000));
 }
});

test('A tall piece lifts no further than a short one: the gap is measured to the bottom edge',()=>{
 const gaps=SHAPES.map(shape=>{const box=land(shape,{x:200,y:500},BLOCK_LIFT.touch);return Math.round((500-(box.top+box.height))*1000);});
 assert.equal(new Set(gaps).size,1,'the gap under the piece changed with the piece height');
});

test('The square the piece lands on is the square it is drawn over',()=>{
 for(const lift of [BLOCK_LIFT.touch,BLOCK_LIFT.mouse])for(const shape of SHAPES)for(const [r,c] of [[0,0],[3,2],[7,7]]){
  const box=land(shape,aim(shape,r,c,lift),lift);
  assert.deepEqual([box.r,box.c],[r,c],`aimed at ${r},${c} and got ${box.r},${box.c}`);
  assert.ok(Math.abs(box.left-(BOARD.left+c*BOARD.step))<.01,'drawn away from the square it reports');
  assert.ok(Math.abs(box.top-(BOARD.top+r*BOARD.step))<.01,'drawn away from the square it reports');
 }
});

test('Half a cell of slop either way still lands on the same square',()=>{
 const shape=SHAPES[0],point=aim(shape,4,3,BLOCK_LIFT.touch);
 for(const dx of [-BOARD.step*.45,0,BOARD.step*.45])for(const dy of [-BOARD.step*.45,0,BOARD.step*.45]){
  const box=land(shape,{x:point.x+dx,y:point.y+dy},BLOCK_LIFT.touch);
  assert.deepEqual([box.r,box.c],[4,3],`${dx},${dy} of slop moved the landing square`);
 }
});

test('The drag geometry works at any board size: the landing square is the same on a small phone',()=>{
 const small={cell:31.8,step:35.8,left:8,top:140};
 for(const shape of SHAPES)for(const [r,c] of [[0,0],[5,6]]){
  const box=dragLanding({...aim(shape,r,c,BLOCK_LIFT.touch,small),...size(shape),lift:BLOCK_LIFT.touch,...small});
  assert.deepEqual([box.r,box.c],[r,c]);
 }
});

test('Scoring and replays are unchanged: a run played through pointer coordinates replays exactly',()=>{
 const byPointer=createBlocks(4242),direct=createBlocks(4242);
 let placed=0;
 for(let move=0;move<24;move++){
  const index=byPointer.state.tray.findIndex(p=>p&&placements(byPointer.state.grid,p.shape).length>0);
  if(index<0)break;
  const shape=byPointer.state.tray[index].shape,[r,c]=placements(byPointer.state.grid,shape)[0];
  // What the player actually does: put a finger somewhere over that square and let go.
  const box=land(shape,aim(shape,r,c,BLOCK_LIFT.touch),BLOCK_LIFT.touch);
  assert.deepEqual([box.r,box.c],[r,c]);
  assert.ok(blocksPlace(byPointer,index,box.r,box.c));
  assert.ok(blocksPlace(direct,index,r,c));
  placed++;
 }
 assert.ok(placed>=10,`only ${placed} pieces placed`);
 const viaPointer=blocksResult(byPointer),viaCode=blocksResult(direct);
 assert.deepEqual(viaPointer,viaCode);
 assert.equal(replayBlocks(viaPointer.replay).score,viaPointer.score);
});
