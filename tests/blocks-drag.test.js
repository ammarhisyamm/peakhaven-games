// Peak Blocks drag feel. The piece you hold is the piece that lands: board-sized, always centred
// sideways on the pointer, with the landing square matching where it is drawn. Vertically there are
// two grips, because a finger and a cursor hide different things: a finger covers the board, so the
// piece floats clear above it; a cursor covers nothing, so it holds the piece in the middle. The
// geometry lives in blocks-core so all of that can be checked without a browser, and the engine is
// untouched: the last test plays a run through pointer coordinates and replays it to the same score.
import test from 'node:test';
import assert from 'node:assert/strict';
const {dragLanding,BLOCK_LIFT,BLOCK_GRIP,createBlocks,blocksPlace,blocksResult,replayBlocks}=await import('../dist/blocks-core.js');
const {SHAPES,placements}=await import('../dist/puzzle-rules.js');

// A board like a 390px-wide phone: 8 columns of 38.25px with a 4px gap.
const BOARD={cell:38.25,step:42.25,left:16,top:180};
const size=shape=>({cols:Math.max(...shape.map(s=>s[0]))+1,rows:Math.max(...shape.map(s=>s[1]))+1});
// The two ways a pointer can hold a piece, named once so every test below reads the same way.
const TOUCH={lift:BLOCK_LIFT.touch,grip:BLOCK_GRIP.touch},MOUSE={lift:BLOCK_LIFT.mouse,grip:BLOCK_GRIP.mouse};
// The pointer position that should drop a piece's top-left corner on cell (r,c), for either grip.
const aim=(shape,r,c,hold,board=BOARD)=>{
 const {cols,rows}=size(shape),width=cols*board.step-(board.step-board.cell),height=rows*board.step-(board.step-board.cell);
 return {x:board.left+c*board.step+width/2,y:board.top+r*board.step+height*hold.grip+hold.lift*board.cell};
};
const land=(shape,point,hold,board=BOARD)=>dragLanding({...point,...size(shape),...hold,...board});

test('A finger holds the piece above itself; a cursor holds it in the middle, with no lift at all',()=>{
 assert.ok(BLOCK_LIFT.touch>=1.5&&BLOCK_LIFT.touch<=2,`touch lift ${BLOCK_LIFT.touch} outside 1.5-2 cells`);
 assert.equal(BLOCK_GRIP.touch,1,'a finger grips the bottom edge, so a tall piece rides no higher');
 assert.equal(BLOCK_LIFT.mouse,0,'a cursor hides nothing, so nothing needs lifting out from under it');
 assert.equal(BLOCK_GRIP.mouse,.5,'and it grips the middle of the piece');
});

test('Either way the piece is centred sideways on the pointer',()=>{
 for(const hold of [TOUCH,MOUSE])for(const shape of SHAPES){
  const box=land(shape,{x:200,y:500},hold);
  assert.equal(Math.round((box.left+box.width/2)*100),200*100,'piece not centred on the pointer');
 }
});

test('On touch the whole piece floats above the finger, by the same gap whatever its height',()=>{
 for(const shape of SHAPES){
  const box=land(shape,{x:200,y:500},TOUCH);
  const gap=500-(box.top+box.height);
  assert.ok(gap>0,'the finger is sitting on the piece');
  assert.equal(Math.round(gap*1000),Math.round(BLOCK_LIFT.touch*BOARD.cell*1000));
 }
});

test('On a mouse the cursor sits in the exact middle of the piece, whatever its shape',()=>{
 for(const shape of SHAPES){
  const box=land(shape,{x:200,y:500},MOUSE);
  assert.equal(Math.round((box.top+box.height/2)*1000),500*1000,'cursor is not on the middle row of the piece');
  assert.equal(Math.round((box.left+box.width/2)*1000),200*1000,'cursor is not on the middle column of the piece');
  assert.ok(500>box.top&&500<box.top+box.height,'the cursor should be inside the piece, not above it');
  assert.ok(200>=box.left&&200<=box.left+box.width);
 }
});

test('A 1x1, a 3x3 and a long line all centre on the cursor the same way',()=>{
 // the three shapes the brief asks to be checked by hand, pinned here as numbers
 const single=[[0,0]],square=[[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]],line=[[0,0],[1,0],[2,0],[3,0],[4,0]];
 for(const shape of [single,square,line]){
  const box=land(shape,{x:200,y:500},MOUSE);
  assert.equal(Math.round((box.top+box.height/2)*1000),500*1000);
  assert.equal(Math.round((box.left+box.width/2)*1000),200*1000);
 }
 // and a 1x1 on a mouse is drawn exactly over the cursor, give or take the gap between cells
 const one=land(single,{x:200,y:500},MOUSE);
 assert.equal(Math.round(one.width*100),Math.round(BOARD.cell*100));
 assert.equal(Math.round(one.height*100),Math.round(BOARD.cell*100));
});

test('A tall piece lifts no further than a short one: the gap is measured to the bottom edge',()=>{
 const gaps=SHAPES.map(shape=>{const box=land(shape,{x:200,y:500},TOUCH);return Math.round((500-(box.top+box.height))*1000);});
 assert.equal(new Set(gaps).size,1,'the gap under the piece changed with the piece height');
});

test('The square the piece lands on is the square it is drawn over',()=>{
 // every corner, the middle of every edge, and somewhere in the middle: the places where being a
 // cell out is easiest to do and easiest to see.
 const SPOTS=[[0,0],[0,7],[7,0],[7,7],[0,4],[7,4],[4,0],[4,7],[3,2]];
 for(const hold of [TOUCH,MOUSE])for(const shape of SHAPES)for(const [r,c] of SPOTS){
  const box=land(shape,aim(shape,r,c,hold),hold);
  assert.deepEqual([box.r,box.c],[r,c],`aimed at ${r},${c} and got ${box.r},${box.c}`);
  assert.ok(Math.abs(box.left-(BOARD.left+c*BOARD.step))<.01,'drawn away from the square it reports');
  assert.ok(Math.abs(box.top-(BOARD.top+r*BOARD.step))<.01,'drawn away from the square it reports');
 }
});

test('Half a cell of slop either way still lands on the same square',()=>{
 const shape=SHAPES[0],point=aim(shape,4,3,TOUCH);
 for(const dx of [-BOARD.step*.45,0,BOARD.step*.45])for(const dy of [-BOARD.step*.45,0,BOARD.step*.45]){
  const box=land(shape,{x:point.x+dx,y:point.y+dy},TOUCH);
  assert.deepEqual([box.r,box.c],[4,3],`${dx},${dy} of slop moved the landing square`);
 }
});

test('The drag geometry works at any board size: the landing square is the same on a small phone',()=>{
 const small={cell:31.8,step:35.8,left:8,top:140};
 for(const shape of SHAPES)for(const [r,c] of [[0,0],[5,6]]){
  const box=dragLanding({...aim(shape,r,c,TOUCH,small),...size(shape),...TOUCH,...small});
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
  const box=land(shape,aim(shape,r,c,TOUCH),TOUCH);
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
