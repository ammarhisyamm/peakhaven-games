// The Sequence clarity pass: what a level tells the player before they start, the one-time
// explanation of ice and traps, how much room the board gets, and the ice/trap drawing itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks} from './ridge-planner.mjs';
import {boardFit,BOARD_GUTTER,BOARD_MAX} from '../dist/sequence-rules.js';
import {levelGoalCard,obstacleIntros,obstacleCards,rememberIntros,OBSTACLES,INTRO_KEY}
  from '../arcade/ui/game/sequence-intro.js';
installStubs();
const {SequenceEngine}=await import('../dist/tryout-games.js');
const {v3Level,createV3Progress,v3Goals}=await import('../dist/sequence-v3.js');

const ICE={kind:'ice',label:'Ice layers',done:0,total:8,left:8};
const LOCK={kind:'lock',label:'Traps',done:0,total:3,left:3};
const SCORE={kind:'score',label:'Score',done:0,total:10300,left:10300};
const COLLECT={kind:'collect',type:2,label:'gold stars',done:0,total:12,left:12};

// ---------- the card a level opens with ----------
test('the level card reads as one short line of what this level wants',()=>{
 const card=levelGoalCard(7,[SCORE,ICE,LOCK],25);
 assert.equal(card.title,'Level 7');
 assert.equal(card.text,'Level 7 · Break 8 ice · Free 3 crystals · 25 moves');
 assert.deepEqual(card.parts.map(p=>p.kind),['ice','lock','moves']);
});
test('the card says "crystal" for one and "crystals" for more, and names what is collected',()=>{
 assert.match(levelGoalCard(3,[{...LOCK,total:1}],20).text,/Free 1 crystal · 20 moves$/);
 assert.match(levelGoalCard(3,[LOCK],20).text,/Free 3 crystals/);
 assert.match(levelGoalCard(9,[COLLECT],18).text,/Collect 12 gold stars/);
});
test('a score-only level still gets a goal, with a big number written short',()=>{
 const card=levelGoalCard(12,[SCORE],22);
 assert.equal(card.text,'Level 12 · Reach 10.3K · 22 moves');
 assert.deepEqual(card.parts.map(p=>p.kind),['score','moves']);
});
test('the score goal is left off when there is something more specific to say',()=>{
 assert.ok(!levelGoalCard(7,[SCORE,ICE],25).parts.some(p=>p.kind==='score'));
});
test('a card survives a level with no goals and no move count',()=>{
 assert.equal(levelGoalCard(1,[],0).text,'Level 1');
 assert.equal(levelGoalCard(1,null,undefined).text,'Level 1');
});
test('every real v3 level produces a card that names its own goals',()=>{
 for(const level of [1,2,5,7,12,20,25,40]){
  const config=v3Level(level),goals=v3Goals(config,createV3Progress(config));
  const card=levelGoalCard(level,goals,config.moves);
  assert.match(card.text,new RegExp(`^Level ${level} · `),`level ${level}`);
  assert.match(card.text,/· \d+ moves$/,`level ${level} ends with its moves`);
  for(const goal of goals)assert.ok(card.parts.some(p=>p.kind===goal.kind),`level ${level} mentions ${goal.kind}`);
 }
});

// ---------- the one-time explanation ----------
test('ice and traps are explained the first time they turn up, and never again',()=>{
 let seen=[];
 const first=obstacleIntros([SCORE,ICE],seen);
 assert.deepEqual(first.map(c=>c.kind),['ice']);
 seen=rememberIntros(seen,first);
 assert.deepEqual(obstacleIntros([SCORE,ICE],seen),[],'the same level again explains nothing');
 const second=obstacleIntros([ICE,LOCK],seen);
 assert.deepEqual(second.map(c=>c.kind),['lock'],'only the part that is new');
 seen=rememberIntros(seen,second);
 assert.deepEqual(obstacleIntros([ICE,LOCK],seen),[]);
 assert.deepEqual(seen,['ice','lock']);
});
test('a level with both, on a fresh device, explains both in a fixed order',()=>{
 assert.deepEqual(obstacleIntros([LOCK,ICE],[]).map(c=>c.kind),['ice','lock']);
 assert.deepEqual(obstacleIntros([SCORE,COLLECT],[]),[],'nothing to explain without ice or traps');
});
test('a lost or broken seen-list offers the cards again rather than failing',()=>{
 for(const broken of [null,undefined,'nonsense',{},0])
  assert.deepEqual(obstacleIntros([ICE],broken).map(c=>c.kind),['ice']);
});
test('the "?" always offers everything this level has, seen or not',()=>{
 assert.deepEqual(obstacleCards([ICE,LOCK]).map(c=>c.kind),['ice','lock']);
 assert.deepEqual(obstacleCards([SCORE]),[],'nothing to reopen on a level with neither');
 for(const card of Object.values(OBSTACLES)){
  assert.ok(card.title.length&&card.line.length);
  assert.match(card.line,/Match next to it/,`${card.kind} tells the player what to do`);
 }
 assert.match(INTRO_KEY,/^ph-sequence-intro-v\d+$/);
});

// ---------- how much room the board gets ----------
test('the board is square and takes the smaller of the width it has and the height left over',()=>{
 const tall=boardFit({width:390,height:844,top:300,bottom:140});
 assert.equal(tall.limitedBy,'width');
 assert.equal(tall.size,390-BOARD_GUTTER*2);
 const squeezed=boardFit({width:390,height:640,top:300,bottom:140});
 assert.equal(squeezed.limitedBy,'height');
 assert.equal(squeezed.size,200);
 assert.equal(squeezed.slack,0,'a height-limited board leaves nothing unused');
});
test('giving the chrome less room gives the board more, up to the width of the screen',()=>{
 const roomy={width:360,height:640,top:150,bottom:60},cramped={width:360,height:640,top:230,bottom:130};
 assert.ok(boardFit(roomy).size>boardFit(cramped).size);
 // Once the height stops being the constraint, taking more chrome away cannot make the board wider.
 assert.equal(boardFit({...roomy,top:80,bottom:40}).size,360-BOARD_GUTTER*2);
 assert.equal(boardFit({...roomy,top:40,bottom:20}).size,360-BOARD_GUTTER*2);
});
test('the board never runs off a screen, however little room it is given',()=>{
 for(const [width,height] of [[320,480],[360,640],[390,844],[430,932],[1440,1000]]){
  for(const [top,bottom] of [[80,40],[200,120],[300,260],[460,460]]){
   const fit=boardFit({width,height,top,bottom});
   assert.ok(fit.size<=width-BOARD_GUTTER*2+1e-9,`${width}x${height} stays inside the width`);
   assert.ok(fit.size<=BOARD_MAX,`${width}x${height} respects the cap`);
   assert.ok(fit.size>=70,`${width}x${height} stays playable`);
   if(fit.size>70)assert.ok(fit.size<=Math.max(0,height-top-bottom)+1e-9,`${width}x${height} fits the room`);
  }
 }
});
test('a very large screen stops growing the board instead of filling the whole page',()=>{
 const fit=boardFit({width:1440,height:1000,top:120,bottom:120});
 assert.equal(fit.size,BOARD_MAX);
 assert.equal(fit.limitedBy,'max');
});

// ---------- ice and traps on the board ----------
function engineAtLevel(level=7){
 const out=stubCallbacks();
 return {engine:new SequenceEngine(stubCanvas(),out.cb,{seed:123,level,rulesVersion:3,motion:false}),out};
}
test('breaking an ice layer or freeing a crystal leaves a crack to draw, which then expires',()=>{
 const {engine}=engineAtLevel();
 const before={ice:[3,1,0,0],locks:[false,false,true,false]};
 const after={ice:[2,0,0,0],locks:[false,false,false,false]};
 engine.cracks=[];
 engine.noteBreaks(before,after);
 assert.deepEqual(engine.cracks.map(c=>[c.i,c.kind]),[[0,'ice'],[1,'ice'],[2,'free']]);
 assert.ok(engine.cracks.every(c=>c.t===0));
 engine.tickEffects(.2);
 assert.equal(engine.cracks.length,3,'still on screen a fifth of a second later');
 engine.tickEffects(.5);
 assert.equal(engine.cracks.length,0,'and gone soon after');
 engine.destroy();
});
test('nothing cracks when a wave leaves the ice and the traps alone',()=>{
 const {engine}=engineAtLevel();
 engine.cracks=[];
 const same={ice:[2,2],locks:[true,false]};
 engine.noteBreaks(same,{ice:[2,2],locks:[true,false]});
 assert.deepEqual(engine.cracks,[]);
 engine.noteBreaks(null,{ice:[1],locks:[false]});
 engine.noteBreaks(same,null);
 assert.deepEqual(engine.cracks,[],'a missing snapshot is not an error');
 engine.destroy();
});
test('a real level with ice and traps draws without error, with cracks in flight',()=>{
 const {engine}=engineAtLevel(7);
 const goals=v3Goals(engine.config,engine.progress);
 assert.ok(goals.some(g=>g.kind==='ice'),'level 7 still has ice to draw');
 assert.doesNotThrow(()=>engine.draw());
 engine.cracks=[{i:engine.progress.ice.findIndex(Boolean),t:.1,kind:'ice',a:.3},{i:0,t:.3,kind:'free',a:1}];
 assert.doesNotThrow(()=>engine.draw(),'a crack over a cell that is already clear still draws');
 engine.destroy();
});
test('the board geometry goes through boardFit and stays inside the canvas',()=>{
 const {engine}=engineAtLevel();
 const g=engine.geometry();
 assert.ok(g.size>0&&g.cell>0);
 assert.equal(g.cell,g.size/7);
 assert.ok(g.x>=0&&g.x+g.size<=engine.w+1e-9,'the board sits inside the canvas across');
 assert.ok(g.y>=0&&g.y+g.size<=engine.h+1e-9,'and down');
 assert.ok(['width','height','max'].includes(g.limitedBy));
 engine.destroy();
});
