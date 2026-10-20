import {createBlocks,blocksPlace,blocksBomb,blocksUndo,blocksShuffle,blocksHint,blocksResult,blocksAssist,anyFit,dragLanding,BLOCK_LIFT,comboFeedback,clearedLines} from './blocks-core.js';
import {clearEvent} from './game-audio.js';
import {makeSeed} from './rng.js';
import {SHAPES,emptyGrid,tileLayout,tileRows,fits,placements,placeBlock,makeTray,bombGrid,dealTiles,freeTile,matchTiles,tileHint} from './puzzle-rules.js';
const symbols=['Blue vial','Pink vial','Gold vial','Purple vial','Green vial','Blue crystal','Pink crystal','Gold crystal','Green crystal'];
const tileArt=kind=>kind>=5?`<span class="tile-gem block-${kind-4}" aria-hidden="true"></span>`:`<span class="happy-vial happy-${kind}" aria-hidden="true"></span>`;
const clone=value=>structuredClone(value);
function controls(root){return Object.fromEntries([...root.querySelectorAll('[data-tool]')].map(b=>[b.dataset.tool,b]));}
export function startBlocks(root,cb,options={}){
 // Rules live in blocks-core.js. `state` mirrors g.state and is re-read after every rules call, since Undo swaps the object.
 const g=createBlocks(options.seed??makeSeed()),tools=g.tools;let state=g.state,bomb=false,paused=false,alive=true,ended=false,hintCells=[];
 const board=root.querySelector('#block-board'),tray=root.querySelector('#block-tray'),buttons=controls(root);
 const locked=()=>paused||!alive||ended;
 const assist=document.createElement('aside');assist.className='block-assist';assist.hidden=true;assist.setAttribute('role','status');assist.setAttribute('aria-live','polite');root.querySelector('.game-tools').before(assist);
 const toolDescriptions={bomb:'Drag Bomb onto the board, or select it then tap a square. Clears a 3 by 3 area.',undo:'Restore your last move.',shuffle:'Replace the pieces in your hand.',hint:'Show where a piece fits.'};
 // The banner and the calling-for-attention tools keep running until the player acts: every action
 // re-renders, and the board is no longer blocked once it lands.
 function help(){
  const advice=blocksAssist(g,{bomb,ended});
  root.classList.toggle('has-block-assist',advice.mode!==null);root.classList.toggle('bomb-mode',bomb);root.classList.toggle('blocks-stuck',advice.mode==='stuck');
  assist.hidden=advice.mode===null;
  if(!assist.hidden&&assist.dataset.text!==advice.title+advice.text){assist.innerHTML='<strong></strong><span></span>';assist.querySelector('strong').textContent=advice.title;assist.querySelector('span').textContent=advice.text;assist.dataset.text=advice.title+advice.text;}
  for(const [k,b]of Object.entries(buttons)){b.classList.toggle('tool-suggested',advice.suggest.includes(k));b.setAttribute('aria-label',`${k[0].toUpperCase()+k.slice(1)}. ${tools[k]} uses left. ${toolDescriptions[k]}`);if(k==='bomb')b.setAttribute('aria-pressed',String(bomb));}
 }

 // The first time a run passes the player's own best for Blocks: once per run, and only if they had a best to beat.
 // It waits for a clear's own label so COMBO and NEW BEST! never land on the same beat.
 const bestToBeat=Math.max(0,Number(options.best)||0);let newBestShown=false;
 function newBest(afterLabel,behind=0){
  if(newBestShown||!bestToBeat||state.score<=bestToBeat)return;
  newBestShown=true;
  setTimeout(()=>{if(!alive)return;cb.effect('NEW BEST!','blocks',{newBest:true});cb.sound('big');},(afterLabel?780:140)+behind);
 }
 // How long a milestone banner holds the stage before the next one, or NEW BEST!, takes it.
 const BANNER_GAP=900;
 // A milestone lands on the same placement as the clear that earned it, so it waits for the clear's own
 // label. The tool itself was already granted by the rules; this only tells the player about it.
 function milestones(rewards,afterLabel){
  (rewards||[]).forEach((reward,i)=>setTimeout(()=>{
   if(!alive)return;
   cb.effect(reward.label,'blocks',{milestone:reward.milestone,tool:reward.tool,lines:reward.lines});
   cb.sound('tool');
   cb.message(`${reward.label}. One extra use, waiting for when you need it.`);
  },(afterLabel?780:140)+i*BANNER_GAP));
 }
 function hud(){cb.hud(state.score,state.lines,state.chain?`${state.chain}×`:'0');for(const [key,b]of Object.entries(buttons)){b.querySelector('b').textContent=tools[key];b.disabled=locked()||tools[key]===0||(key==='undo'&&!g.history.length);b.classList.toggle('active',key==='bomb'&&bomb);}help();}
 function render(){const focused=document.activeElement?.dataset.cell;board.innerHTML=state.grid.flatMap((row,r)=>row.map((v,c)=>`<button class="block-cell ${v?'filled block-'+v:''} ${hintCells.some(([rr,cc])=>rr===r&&cc===c)?'suggested':''}" data-cell="${r*8+c}" role="gridcell" tabindex="${Number(focused||0)===r*8+c?0:-1}" aria-label="Row ${r+1}, column ${c+1}: ${v?'occupied':'empty'}"></button>`)).join('');tray.innerHTML=state.tray.map((p,i)=>`<button class="shape-slot ${state.selected===i?'selected':''} ${p&&!placements(state.grid,p.shape).length?'no-fit':''}" data-shape="${i}" ${!p?'disabled':''} aria-label="${p?`Piece ${i+1}, ${p.shape.length} blocks. Drag onto the board, or select then tap its top-left square.`:'Used piece'}" aria-pressed="${state.selected===i}">${p?`<span class="shape-preview" style="--cols:${Math.max(...p.shape.map(p=>p[0]))+1};--rows:${Math.max(...p.shape.map(p=>p[1]))+1}">${p.shape.map(([x,y])=>`<i class="block-${p.color}" style="grid-column:${x+1};grid-row:${y+1}"></i>`).join('')}</span>`:'<svg class="icon piece-done" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'}</button>`).join('');board.querySelectorAll('[data-cell]').forEach(b=>{const index=Number(b.dataset.cell),r=Math.floor(index/8),c=index%8;b.onclick=()=>place(r,c);b.onpointerenter=()=>preview(r,c);b.onfocus=()=>preview(r,c);b.onkeydown=e=>{let next=index;if(e.key==='ArrowRight')next=Math.min(63,index+1);else if(e.key==='ArrowLeft')next=Math.max(0,index-1);else if(e.key==='ArrowDown')next=Math.min(63,index+8);else if(e.key==='ArrowUp')next=Math.max(0,index-8);else return;e.preventDefault();board.querySelectorAll('[data-cell]').forEach(x=>x.tabIndex=-1);const target=board.querySelector(`[data-cell="${next}"]`);target.tabIndex=0;target.focus();};});tray.querySelectorAll('[data-shape]').forEach(b=>b.onclick=e=>{if(locked())return;state.selected=Number(b.dataset.shape);bomb=false;hintCells=[];render();if(!e.detail)cb.sound('select');cb.message('Piece selected. Tap its top-left square on the board.');});hud();if(focused!==undefined)board.querySelector(`[data-cell="${focused}"]`)?.focus({preventScroll:true});}
 // Board preview: the cells the piece would fill, plus every row and column it would complete.
 function clearPreview(){board.querySelectorAll('.ghost,.clear-preview,.bomb-target,.bomb-centre').forEach(b=>b.classList.remove('ghost','clear-preview','bomb-target','bomb-centre'));}
 function preview(r,c){clearPreview();if(locked())return;
  if(bomb){if(r<0||r>7||c<0||c>7)return;for(let rr=Math.max(0,r-1);rr<=Math.min(7,r+1);rr++)for(let cc=Math.max(0,c-1);cc<=Math.min(7,c+1);cc++)board.querySelector(`[data-cell="${rr*8+cc}"]`)?.classList.add('bomb-target');board.querySelector(`[data-cell="${r*8+c}"]`)?.classList.add('bomb-centre');return;}
const p=state.tray[state.selected];if(!p)return;const out=placeBlock(state.grid,p.shape,r,c,p.color);if(!out)return;
  for(const [x,y]of p.shape)board.querySelector(`[data-cell="${(r+y)*8+c+x}"]`)?.classList.add('ghost');
  for(const [rr,cc]of out.cleared)board.querySelector(`[data-cell="${rr*8+cc}"]`)?.classList.add('clear-preview');}
 function afterAction(){if(g.ended){finish();return;}hud();if(!anyFit(g))cb.message('No space left! Use one of the glowing tools to make room.');}
 // Block Blast style: every placement snaps; a clear pops on top, pitched up two semitones per combo step, with one more sparkle per step.
function clearSound(out){if(out.lines){const rate=2**((Math.min(out.combo||1,6)-1)/6),feel=comboFeedback(out);
  // One cue per combo level, and a separate big clear. Today every level points at the sound we already
  // ship, so this changes nothing a player hears; it is the hook the new samples will land on.
  cb.sound(clearEvent({combo:feel.combo,big:feel.big}),{rate});
  for(let i=1;i<Math.min(out.combo||1,5);i++)cb.sound('sparkle',{rate:rate*2**((i*2)/12)*1.2,delay:.05+i*.045});}cb.sound('drop');}
function place(r,c){if(locked())return;if(bomb){if(!blocksBomb(g,r,c)){cb.sound('invalid');cb.message('Choose a square near filled blocks.');return;}state=g.state;bomb=false;cb.effect('SPACE CLEARED!','blocks');cb.sound('merge');render();afterAction();return;}const p=state.tray[state.selected];if(!p){cb.sound('invalid');cb.message('Select a piece from the tray first.');return;}const before=state.grid.map(row=>[...row]),out=blocksPlace(g,state.selected,r,c);if(!out){cb.sound('invalid');cb.message('That piece needs empty squares. Try another spot.');return;}state=g.state;hintCells=[];render();landed(p,r,c,out);blast(out,before,p.color,r,c);clearSound(out);cb.message(out.lines?`${out.lines} ${out.lines===1?'line':'lines'} cleared! +${out.points}${out.combo>1?` · combo ${out.combo}`:''}`:'Lovely fit. Keep a little space for the next piece.');let shown=false;if(out.lines){const praise=['','','GREAT!','EXCELLENT!','AMAZING!','UNBELIEVABLE!','UNBELIEVABLE!'][Math.min(out.lines,6)],label=out.perfect?'PERFECT CLEAR!':out.combo>1?`COMBO ${out.combo}${praise?` · ${praise}`:''}`:praise;if(label){cb.effect(label,'blocks',{lines:out.lines,combo:out.combo,perfect:out.perfect,points:out.points});shown=true;}}const feel=comboFeedback(out,{motion});shake(feel);comboCount(feel);lineBurst(out,p.color);
  milestones(out.rewards,shown);newBest(shown,(out.rewards?.length||0)*BANNER_GAP);cb.progress?.({lines:state.lines});afterAction();}
 // Clear effects, modelled on Block Blast: every cleared block bursts (a flash, then it shrinks away and throws
 // shards), sweeping out from where the piece landed; the points for the move float up from the cleared lines; and the
 // piece just placed settles with a small bounce. Purely visual: it never touches the game state.
 const motion=options.motion!==false;
 function layer(){let el=root.querySelector('.blast-layer');if(!el){el=document.createElement('div');el.className='blast-layer';el.setAttribute('aria-hidden','true');root.append(el);}return el;}
 function landed(p,r,c,out){if(!motion)return;const gone=new Set(out.cleared.map(([rr,cc])=>rr*8+cc));for(const [x,y]of p.shape){const i=(r+y)*8+c+x;if(gone.has(i))continue;board.querySelector(`[data-cell="${i}"]`)?.animate([{transform:'scale(.82)'},{transform:'scale(1.06)',offset:.6},{transform:'scale(1)'}],{duration:220,easing:'ease-out'});}}
 // A short shake of the board, stronger with the combo. comboFeedback decides how far and for how long,
 // and returns 0 when motion is off, so there is one place to read the feel from.
 function shake(feel){
  if(!feel.shake)return;
  const stage=root.querySelector('.puzzle-stage')||board;
  const swing=feel.shake,steps=[0,-.7,.55,-.4,.25,0].map((k,i)=>({transform:`translate3d(${(swing*k).toFixed(2)}px, ${(swing*k*-.55).toFixed(2)}px, 0)`,offset:i/5}));
  stage.animate?.(steps,{duration:feel.ms,easing:'ease-out'});
 }
 // The combo count, big and on its own, over the board. The praise label keeps its place above it.
 function comboCount(feel){
  if(!feel.label)return;
  const host=layer(),el=document.createElement('b');
  el.className='combo-count';el.textContent=feel.label;el.setAttribute('aria-hidden','true');
  host.append(el);
  if(!motion){el.animate([{opacity:1},{opacity:0}],{duration:520,fill:'both'}).onfinish=()=>el.remove();return;}
  el.animate([
   {opacity:0,transform:'translate(-50%,-50%) scale(.5)'},
   {opacity:1,transform:'translate(-50%,-50%) scale(1.18)',offset:.28},
   {opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.62},
   {opacity:0,transform:'translate(-50%,-62%) scale(1)'},
  ],{duration:760,easing:'cubic-bezier(.22,1,.3,1)',fill:'both'}).onfinish=()=>el.remove();
 }
 // A burst along each cleared line. The per-cell shards in blast() say "these blocks broke"; this says
 // "this line went", fanning out from the middle of the line and along it, so four lines read as four events.
 function lineBurst(out,color){
  if(!motion||!out.lines)return;
  const host=layer(),box=root.getBoundingClientRect(),{rows,cols}=clearedLines(out.cleared);
  const centre=(r,c)=>{const cell=board.querySelector(`[data-cell="${r*8+c}"]`);if(!cell)return null;
   const b=cell.getBoundingClientRect();return {x:b.left-box.left+b.width/2,y:b.top-box.top+b.height/2,size:b.width};};
  const fan=(from,to,count)=>{
   if(!from||!to)return;
   const mid={x:(from.x+to.x)/2,y:(from.y+to.y)/2},span=Math.hypot(to.x-from.x,to.y-from.y)||1;
   const ux=(to.x-from.x)/span,uy=(to.y-from.y)/span;
   for(let i=0;i<count;i++){
    const spark=document.createElement('i'),along=((i+.5)/count-.5)*2;
    spark.className=`blast-spark block-${color}`;
    spark.style.cssText=`left:${mid.x}px;top:${mid.y}px;width:${from.size*.3}px;height:${from.size*.3}px`;
    host.append(spark);
    const reach=span*.6*along,drift=(Math.random()-.5)*from.size*1.4;
    spark.animate([
     {transform:'translate(-50%,-50%) scale(1)',opacity:1},
     {transform:`translate(calc(-50% + ${(ux*reach-uy*drift).toFixed(1)}px), calc(-50% + ${(uy*reach+ux*drift).toFixed(1)}px)) scale(.15)`,opacity:0},
    ],{duration:420+Math.random()*260,easing:'cubic-bezier(.2,.7,.3,1)',fill:'both'}).onfinish=()=>spark.remove();
   }
  };
  for(const r of rows)fan(centre(r,0),centre(r,7),10);
  for(const c of cols)fan(centre(0,c),centre(7,c),10);
 }
 function blast(out,before,color,r,c){
  if(!out.lines)return;const host=layer(),box=root.getBoundingClientRect();
  const origin=[r+1,c+1];let sx=0,sy=0;
  for(const [rr,cc]of out.cleared){const cell=board.querySelector(`[data-cell="${rr*8+cc}"]`);if(!cell)continue;const b=cell.getBoundingClientRect(),x=b.left-box.left,y=b.top-box.top,w=b.width,tint=before[rr][cc]||color;sx+=x+w/2;sy+=y+w/2;
   const block=document.createElement('i');block.className=`blast-cell block-${tint}`;block.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${w}px`;host.append(block);
   const delay=Math.hypot(rr-origin[0],cc-origin[1])*26;
   if(!motion){block.animate([{opacity:1},{opacity:0}],{duration:280,fill:'both'}).onfinish=()=>block.remove();continue;}
   block.animate([{transform:'scale(1)',boxShadow:'0 0 0 0 #ffffff00'},{transform:'scale(1.2)',boxShadow:'0 0 18px 6px #ffffffee',offset:.3},{transform:'scale(.15) rotate(30deg)',boxShadow:'0 0 6px 2px #ffffff00',opacity:0}],{duration:430,delay,easing:'cubic-bezier(.3,.7,.4,1)',fill:'both'}).onfinish=()=>block.remove();
   for(let k=0;k<3;k++){const shard=document.createElement('i'),size=w*.34,a=Math.random()*Math.PI*2,dist=w*(1.1+Math.random()*1.5);shard.className=`blast-shard block-${tint}`;shard.style.cssText=`left:${x+w/2-size/2}px;top:${y+w/2-size/2}px;width:${size}px;height:${size}px`;host.append(shard);
    shard.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${Math.cos(a)*dist}px,${Math.sin(a)*dist+w}px) scale(.35) rotate(${Math.round(a*120)}deg)`,opacity:0}],{duration:560+Math.random()*220,delay:delay+70,easing:'cubic-bezier(.2,.6,.4,1)',fill:'both'}).onfinish=()=>shard.remove();}
  }
  const n=out.cleared.length||1,points=document.createElement('b');points.className=`blast-points${out.combo>1?' combo':''}${out.lines>1||out.perfect?' big':''}`;points.textContent=`+${out.points.toLocaleString('en-AU')}`;points.style.cssText=`left:${sx/n}px;top:${sy/n}px`;host.append(points);
  points.animate(motion?[{transform:'translate(-50%,-30%) scale(.6)',opacity:0},{transform:'translate(-50%,-80%) scale(1.15)',opacity:1,offset:.2},{transform:'translate(-50%,-150%) scale(1)',opacity:1,offset:.7},{transform:'translate(-50%,-210%) scale(1)',opacity:0}]:[{transform:'translate(-50%,-50%)',opacity:1},{transform:'translate(-50%,-50%)',opacity:0}],{duration:1100,easing:'ease-out',fill:'both'}).onfinish=()=>points.remove();
 }
 // Dragging works like Lattice in the tryout arcade: the piece lifts at full board size the moment it is
 // touched and snaps to the nearest cells. On touch it floats centred about 1.75 cells above the finger so
 // the thumb never hides it; with a mouse or pen it sits centred on the pointer. The landing spot and any lines it would clear light up; an invalid drop goes back to the tray.
 // A tap without moving still selects the piece, and keyboard play is unchanged.
 // Block Blast's drag: the piece you hold is the piece that lands, at board size, floating clear of
 // the pointer so your hand never covers it. A finger needs the whole piece clear of it; a cursor only
 // needs to not sit on top of the piece, so BLOCK_LIFT lifts the two by different amounts.
 const TAP_SLOP=6,RETURN_MS=160;
 let drag=null,dragArt=null,suppressClick=false,dragFrame=0;
 const buzz=ms=>{try{navigator.vibrate?.(ms);}catch{}};
 function boardMetrics(){const a=board.querySelector('[data-cell="0"]').getBoundingClientRect(),b=board.querySelector('[data-cell="1"]').getBoundingClientRect();return {cell:a.width,step:b.left-a.left,left:a.left,top:a.top};}
 function clearDrag(){const pointer=drag?.pointerId;drag=null;if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
  try{if(tray.hasPointerCapture?.(pointer))tray.releasePointerCapture(pointer);}catch{}dragArt?.remove();dragArt=null;tray.querySelector('.lifted')?.classList.remove('lifted');clearPreview();}
 function liftPiece(){const art=tray.querySelector(`[data-shape="${drag.index}"] .shape-preview`);if(!art)return;
  // The board is measured once per drag. Reading it on every pointermove forced a layout each time,
  // which is what made a fast drag stutter on a phone.
  const m=drag.metrics;
  dragArt=art.cloneNode(true);dragArt.classList.add('block-drag-preview');
  dragArt.style.setProperty('--cell',`${m.cell}px`);dragArt.style.setProperty('--gap',`${m.step-m.cell}px`);
  root.append(dragArt);
  tray.querySelector(`[data-shape="${drag.index}"]`)?.classList.add('lifted');buzz(8);}
 // Pointer events can arrive several times a frame; the screen only changes once, so the write is
 // coalesced into one rAF and the board preview is touched only when the landing square changes.
 function follow(e){if(!drag)return;drag.clientX=e.clientX;drag.clientY=e.clientY;
  if(!dragFrame)dragFrame=requestAnimationFrame(paintDrag);}
 function paintDrag(){dragFrame=0;if(!drag||!dragArt)return;
  const p=state.tray[drag.index];if(!p)return;
  const cols=Math.max(...p.shape.map(s=>s[0]))+1,rows=Math.max(...p.shape.map(s=>s[1]))+1;
  const {left,top,r,c}=dragLanding({x:drag.clientX,y:drag.clientY,cols,rows,lift:drag.lift,...drag.metrics});
  dragArt.style.translate=`${Math.round(left)}px ${Math.round(top)}px`;
  const valid=fits(state.grid,p.shape,r,c);
  if(r!==drag.r||c!==drag.c||valid!==drag.valid){
   drag.r=r;drag.c=c;drag.valid=valid;dragArt.classList.toggle('invalid',!valid);
   if(valid)preview(r,c);else board.querySelectorAll('.ghost,.clear-preview').forEach(b=>b.classList.remove('ghost','clear-preview'));
  }}
 // A piece dropped somewhere it cannot go flies back to its slot instead of blinking out of existence.
 function returnToTray(){const art=dragArt,index=drag?.index;
  if(!art||!motion||index===undefined){clearDrag();return;}
  const slot=tray.querySelector(`[data-shape="${index}"] .shape-preview`);
  const from=art.getBoundingClientRect(),to=slot?.getBoundingClientRect();
  dragArt=null;drag=null;if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
  // A flick shorter than the pick-up scale would leave both animations on the piece at once, and the
  // two scales would multiply. The lift has done its job by now, so it stands down.
  art.style.animation='none';
  clearPreview();
  if(!to){art.remove();tray.querySelector('.lifted')?.classList.remove('lifted');return;}
  art.animate([{translate:art.style.translate,scale:1,opacity:1},
   {translate:`${Math.round(to.left)}px ${Math.round(to.top)}px`,scale:to.width/(from.width||1),opacity:.3}],
   {duration:RETURN_MS,easing:'cubic-bezier(.3,0,.5,1)',fill:'forwards'})
   .finished.catch(()=>{}).then(()=>{art.remove();tray.querySelector('.lifted')?.classList.remove('lifted');});}
 const dragDown=e=>{const slot=e.target.closest('[data-shape]');if(drag||bombPointer||locked()||e.isPrimary===false||(e.button!==undefined&&e.button!==0)||!slot||!state.tray[slot.dataset.shape])return;
  drag={pointerId:e.pointerId,index:Number(slot.dataset.shape),x:e.clientX,y:e.clientY,moving:false,
   lift:e.pointerType==='touch'?BLOCK_LIFT.touch:BLOCK_LIFT.mouse,metrics:boardMetrics(),r:null,c:null,valid:null};
  tray.setPointerCapture?.(e.pointerId);
  state.selected=drag.index;bomb=false;hintCells=[];liftPiece();follow(e);paintDrag();cb.sound('select');};
 const dragMove=e=>{if(!drag||e.pointerId!==drag.pointerId||locked())return;if(!drag.moving&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>=TAP_SLOP)drag.moving=true;follow(e);};
 const dragUp=e=>{if(!drag||e.pointerId!==drag.pointerId)return;
  drag.clientX=e.clientX;drag.clientY=e.clientY;paintDrag();
  const last=drag;
  if(!last.moving){clearDrag();render();return;} // a tap: the click handler selects it
  suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
  if(locked()){clearDrag();return;}
  if(last.valid){clearDrag();buzz(12);place(last.r,last.c);}
  else{returnToTray();render();cb.sound('invalid');cb.message('That spot is taken. The piece is back in the tray.');}};
 const dragCancel=e=>{if(!e||e.type==='blur'||e.pointerId===drag?.pointerId)clearDrag();};const dragClick=e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}};
 for(const [name,handler] of [['pointerdown',dragDown],['pointermove',dragMove],['pointerup',dragUp],['pointercancel',dragCancel],['lostpointercapture',dragCancel]])tray.addEventListener(name,handler);tray.addEventListener('click',dragClick,true);window.addEventListener('blur',dragCancel);
 // Bomb supports the same lifted, single-pointer gesture as a piece, with its complete impact area visible.
 let bombPointer=null,bombArt=null,suppressBombClick=false;
 function clearBombPointer(){const id=bombPointer?.id;bombPointer=null;try{if(buttons.bomb.hasPointerCapture?.(id))buttons.bomb.releasePointerCapture(id);}catch{}bombArt?.remove();bombArt=null;clearPreview();}
 function bombFollow(e){
  if(!bombPointer)return;const m=boardMetrics(),x=e.clientX,y=e.clientY-(e.pointerType==='touch'?1.5*m.step:0);
  bombPointer.r=Math.floor((y-m.top)/m.step);bombPointer.c=Math.floor((x-m.left)/m.step);
  const {r,c}=bombPointer;bombPointer.valid=r>=0&&r<8&&c>=0&&c<8&&state.grid.some((row,rr)=>row.some((v,cc)=>v&&Math.abs(rr-r)<=1&&Math.abs(cc-c)<=1));
  if(bombArt){bombArt.style.left=`${x}px`;bombArt.style.top=`${y}px`;bombArt.classList.toggle('invalid',!bombPointer.valid);}preview(r,c);
 }
 const bombDown=e=>{if(drag||bombPointer||locked()||!tools.bomb||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;bombPointer={id:e.pointerId,x:e.clientX,y:e.clientY,moving:false};buttons.bomb.setPointerCapture?.(e.pointerId);};
 const bombMove=e=>{if(!bombPointer||e.pointerId!==bombPointer.id||locked())return;if(!bombPointer.moving&&Math.hypot(e.clientX-bombPointer.x,e.clientY-bombPointer.y)>=TAP_SLOP){bombPointer.moving=true;bomb=true;hintCells=[];hud();bombArt=document.createElement('div');bombArt.className='bomb-drag-preview';bombArt.setAttribute('aria-hidden','true');bombArt.innerHTML=`${buttons.bomb.querySelector('svg').outerHTML}<span>Bomb</span>`;root.append(bombArt);cb.sound('tool');}if(bombPointer.moving){e.preventDefault();bombFollow(e);}};
 const bombUp=e=>{if(!bombPointer||e.pointerId!==bombPointer.id)return;if(!bombPointer.moving){clearBombPointer();return;}bombFollow(e);const last=bombPointer;clearBombPointer();suppressBombClick=true;setTimeout(()=>{suppressBombClick=false;},0);if(locked())return;if(last.valid)place(last.r,last.c);else{cb.sound('invalid');cb.message('Bomb not used. Drop it over filled squares, or tap Bomb to cancel.');hud();}};
 const bombCancel=e=>{if(!bombPointer||e?.pointerId!==undefined&&e.pointerId!==bombPointer.id)return;clearBombPointer();bomb=false;hud();};
 for(const [name,handler]of [['pointerdown',bombDown],['pointermove',bombMove],['pointerup',bombUp],['pointercancel',bombCancel],['lostpointercapture',bombCancel]])buttons.bomb.addEventListener(name,handler);
 window.addEventListener('blur',bombCancel);
 buttons.bomb.onclick=()=>{if(suppressBombClick){suppressBombClick=false;return;}if(locked()||!tools.bomb)return;bomb=!bomb;hintCells=[];clearPreview();hud();cb.sound('tool');cb.message(bomb?'Bomb ready. Drag it onto the board, or tap a square. The outline shows the 3 by 3 area.':'Bomb cancelled. Select a piece to keep playing.');};

 buttons.undo.onclick=()=>{if(locked()||!blocksUndo(g))return;state=g.state;bomb=false;hintCells=[];render();cb.sound('undo');cb.message('Last move restored.');afterAction();};
 buttons.shuffle.onclick=()=>{if(locked()||!blocksShuffle(g))return;state=g.state;bomb=false;hintCells=[];render();if(motion)tray.querySelectorAll('.shape-preview').forEach((p,i)=>p.animate([{transform:'translateY(9px) rotate(-8deg) scale(.75)',opacity:.2},{transform:'translateY(-3px) rotate(4deg) scale(1.04)',opacity:1,offset:.65},{transform:'none',opacity:1}],{duration:240,delay:i*35,easing:'cubic-bezier(.16,1,.3,1)'}));cb.sound('shuffle');cb.message('Three fresh pieces. Find a new fit.');afterAction();};
 buttons.hint.onclick=()=>{if(locked()||!tools.hint)return;const best=blocksHint(g);if(!best){cb.sound('invalid');cb.message('Try Bomb or Shuffle to make space.');return;}state=g.state;bomb=false;hintCells=best.shape.map(([x,y])=>[best.r+y,best.c+x]);render();cb.sound('hint');cb.message(`Place piece ${best.i+1} at row ${best.r+1}, column ${best.c+1}.`);};
 function finish(){if(ended||!alive)return;ended=true;hud();cb.end(blocksResult(g));}
 render();cb.message('Drag a piece onto the board, or tap a piece then its top-left square.');return {pause(value=true){paused=value;clearDrag();clearBombPointer();bomb=false;hud();},finish,destroy(){alive=false;clearDrag();clearBombPointer();assist.remove();for(const [name,handler]of [['pointerdown',bombDown],['pointermove',bombMove],['pointerup',bombUp],['pointercancel',bombCancel],['lostpointercapture',bombCancel]])buttons.bomb.removeEventListener(name,handler);window.removeEventListener('blur',bombCancel);for(const [name,handler] of [['pointerdown',dragDown],['pointermove',dragMove],['pointerup',dragUp],['pointercancel',dragCancel],['lostpointercapture',dragCancel]])tray.removeEventListener(name,handler);tray.removeEventListener('click',dragClick,true);window.removeEventListener('blur',dragCancel);},action(){}};
}
export function startMahjong(root,cb,options={}){
 let tiles=dealTiles(tileLayout(options.level),Math.random,Math.min(9,6+Math.floor((options.level||1)/8))),selected=null,history=[],score=0,pairs=0,chain=0,paused=false,alive=true,ended=false,highlight=[],tools={hint:3,undo:3,shuffle:3};const board=root.querySelector('#mahjong-board'),buttons=controls(root),locked=()=>paused||!alive||ended,rows=tileRows(options.level);board.style.aspectRatio=`6 / ${rows}`;board.style.setProperty('--tile-row',`${100/rows}%`);board.style.setProperty('--tile-height',`${115/rows}%`);board.style.setProperty('--tile-lift',`${7.5/rows}%`);
 board.classList.toggle('dense',options.level>=4);
 function render(){const focused=document.activeElement?.dataset.tile;board.innerHTML=tiles.map(t=>{const free=freeTile(t,tiles);return `<button class="mahjong-tile ${free?'free':'covered'} ${selected===t.id?'selected':''} ${highlight.includes(t.id)?'suggested':''}" data-tile="${t.id}" style="--x:${t.x};--y:${t.y};--z:${t.z}" ${!free?'disabled':''} aria-label="${symbols[t.kind]}, layer ${t.z+1}, ${free?'available':'blocked'}" aria-pressed="${selected===t.id}">${tileArt(t.kind)}</button>`;}).join('');board.querySelectorAll('[data-tile]').forEach(b=>b.onclick=()=>pick(Number(b.dataset.tile)));cb.hud(score,tiles.length/2,chain?`${chain}×`:'0');for(const [k,b]of Object.entries(buttons)){b.querySelector('b').textContent=tools[k];b.disabled=locked()||!tools[k]||(k==='undo'&&!history.length);}if(focused!==undefined)board.querySelector(`[data-tile="${focused}"]`)?.focus({preventScroll:true});}
 function pick(id){if(locked())return;const t=tiles.find(t=>t.id===id);if(!t||!freeTile(t,tiles))return;highlight=[];if(selected===id){selected=null;render();cb.sound('undo');return;}if(selected===null){selected=id;render();cb.sound('select');cb.message(`${symbols[t.kind]} selected. Find its matching open tile.`);return;}const next=matchTiles(tiles,selected,id);if(!next){chain=0;selected=id;render();cb.sound('invalid');cb.message('Match two identical open tiles. One side must be free.');return;}history.push({tiles:clone(tiles),score,pairs,chain});tiles=next;selected=null;pairs++;chain++;score+=100+Math.min(chain,5)*20;render();cb.effect(chain>1?`${chain}× MATCH!`:'PAIR MATCHED!','mahjong');cb.sound('perfect');cb.message('Lovely pair. A little more of the garden revealed.');if(!tiles.length){ended=true;render();setTimeout(()=>{if(alive)cb.end({score,pairs,moves:pairs,won:true});},450);}else if(!tileHint(tiles))cb.message('No clear route remains. Undo a pair or shuffle the open board.');}
 buttons.hint.onclick=()=>{if(locked()||!tools.hint)return;const pair=tileHint(tiles);if(!pair){cb.message('Try Undo or Shuffle to find a fresh route.');return;}tools.hint--;highlight=pair;selected=pair[0];render();cb.sound('hint');cb.message('The glowing pair keeps a path to the finish.');};
 buttons.undo.onclick=()=>{if(locked()||!history.length||!tools.undo)return;const old=history.pop();tiles=old.tiles;score=old.score;pairs=old.pairs;chain=old.chain;selected=null;highlight=[];tools.undo--;render();cb.sound('undo');cb.message('Your last pair is back. Try a different match.');};
 buttons.shuffle.onclick=()=>{if(locked()||!tools.shuffle)return;history.push({tiles:clone(tiles),score,pairs,chain});try{tiles=dealTiles(tiles);}catch{tiles=dealTiles(tiles.map((t,i)=>({...t,x:i%6,y:Math.floor(i/6),z:0})));}selected=null;highlight=[];tools.shuffle--;render();cb.sound('tool');cb.message('Fresh matches, with a route to clear every tile.');};
 render();cb.message('Match two identical tiles with an open side and nothing on top.');return {pause(value=true){paused=value;},finish(){if(!ended&&alive){ended=true;cb.end({score,pairs,moves:pairs,won:false});}},destroy(){alive=false;},action(){}};
}
