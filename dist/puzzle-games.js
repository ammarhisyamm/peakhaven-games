import {createBlocks,blocksPlace,blocksBomb,blocksUndo,blocksShuffle,blocksHint,blocksResult,anyFit} from './blocks-core.js';
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
 // The first time a run passes the player's own best for Blocks: once per run, and only if they had a best to beat.
 // It waits for a clear's own label so COMBO and NEW BEST! never land on the same beat.
 const bestToBeat=Math.max(0,Number(options.best)||0);let newBestShown=false;
 function newBest(afterLabel){
  if(newBestShown||!bestToBeat||state.score<=bestToBeat)return;
  newBestShown=true;
  setTimeout(()=>{if(!alive)return;cb.effect('NEW BEST!','blocks',{newBest:true});cb.sound('big');},afterLabel?780:140);
 }
 function hud(){cb.hud(state.score,state.lines,state.chain?`${state.chain}×`:'0');for(const [key,b]of Object.entries(buttons)){b.querySelector('b').textContent=tools[key];b.disabled=locked()||tools[key]===0||(key==='undo'&&!g.history.length);b.classList.toggle('active',key==='bomb'&&bomb);}}
 function render(){const focused=document.activeElement?.dataset.cell;board.innerHTML=state.grid.flatMap((row,r)=>row.map((v,c)=>`<button class="block-cell ${v?'filled block-'+v:''} ${hintCells.some(([rr,cc])=>rr===r&&cc===c)?'suggested':''}" data-cell="${r*8+c}" role="gridcell" tabindex="${Number(focused||0)===r*8+c?0:-1}" aria-label="Row ${r+1}, column ${c+1}: ${v?'occupied':'empty'}"></button>`)).join('');tray.innerHTML=state.tray.map((p,i)=>`<button class="shape-slot ${state.selected===i?'selected':''} ${p&&!placements(state.grid,p.shape).length?'no-fit':''}" data-shape="${i}" ${!p?'disabled':''} aria-label="${p?`Piece ${i+1}, ${p.shape.length} blocks. Drag onto the board, or select then tap its top-left square.`:'Used piece'}" aria-pressed="${state.selected===i}">${p?`<span class="shape-preview" style="--cols:${Math.max(...p.shape.map(p=>p[0]))+1};--rows:${Math.max(...p.shape.map(p=>p[1]))+1}">${p.shape.map(([x,y])=>`<i class="block-${p.color}" style="grid-column:${x+1};grid-row:${y+1}"></i>`).join('')}</span>`:'<svg class="icon piece-done" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'}</button>`).join('');board.querySelectorAll('[data-cell]').forEach(b=>{const index=Number(b.dataset.cell),r=Math.floor(index/8),c=index%8;b.onclick=()=>place(r,c);b.onpointerenter=()=>preview(r,c);b.onfocus=()=>preview(r,c);b.onkeydown=e=>{let next=index;if(e.key==='ArrowRight')next=Math.min(63,index+1);else if(e.key==='ArrowLeft')next=Math.max(0,index-1);else if(e.key==='ArrowDown')next=Math.min(63,index+8);else if(e.key==='ArrowUp')next=Math.max(0,index-8);else return;e.preventDefault();board.querySelectorAll('[data-cell]').forEach(x=>x.tabIndex=-1);const target=board.querySelector(`[data-cell="${next}"]`);target.tabIndex=0;target.focus();};});tray.querySelectorAll('[data-shape]').forEach(b=>b.onclick=()=>{if(locked())return;state.selected=Number(b.dataset.shape);bomb=false;hintCells=[];render();cb.sound('select');cb.message('Piece selected. Tap its top-left square on the board.');});hud();if(focused!==undefined)board.querySelector(`[data-cell="${focused}"]`)?.focus({preventScroll:true});}
 // Board preview: the cells the piece would fill, plus every row and column it would complete.
 function preview(r,c){board.querySelectorAll('.ghost,.clear-preview').forEach(b=>b.classList.remove('ghost','clear-preview'));if(locked()||bomb)return;const p=state.tray[state.selected];if(!p)return;const out=placeBlock(state.grid,p.shape,r,c,p.color);if(!out)return;
  for(const [x,y]of p.shape)board.querySelector(`[data-cell="${(r+y)*8+c+x}"]`)?.classList.add('ghost');
  for(const [rr,cc]of out.cleared)board.querySelector(`[data-cell="${rr*8+cc}"]`)?.classList.add('clear-preview');}
 function afterAction(){if(g.ended){finish();return;}if(!anyFit(g))cb.message('No space for this tray. Use Bomb or Shuffle, or finish from Pause.');}
 // Block Blast style: every placement snaps; a clear pops on top, pitched up two semitones per combo step, with one more sparkle per step.
function clearSound(out){if(out.lines){const rate=2**((Math.min(out.combo||1,6)-1)/6),big=out.lines>=2||out.perfect;cb.sound(big?'big':'perfect',{rate});for(let i=1;i<Math.min(out.combo||1,5);i++)cb.sound('sparkle',{rate:rate*2**((i*2)/12)*1.2,delay:.05+i*.045});}cb.sound('drop');}
function place(r,c){if(locked())return;if(bomb){if(!blocksBomb(g,r,c)){cb.sound('invalid');cb.message('Choose a square near filled blocks.');return;}state=g.state;bomb=false;cb.effect('SPACE CLEARED!','blocks');cb.sound('merge');render();afterAction();return;}const p=state.tray[state.selected];if(!p){cb.sound('invalid');cb.message('Select a piece from the tray first.');return;}const before=state.grid.map(row=>[...row]),out=blocksPlace(g,state.selected,r,c);if(!out){cb.sound('invalid');cb.message('That piece needs empty squares. Try another spot.');return;}state=g.state;hintCells=[];render();landed(p,r,c,out);blast(out,before,p.color,r,c);clearSound(out);cb.message(out.lines?`${out.lines} ${out.lines===1?'line':'lines'} cleared! +${out.points}${out.combo>1?` · combo ${out.combo}`:''}`:'Lovely fit. Keep a little space for the next piece.');let shown=false;if(out.lines){const praise=['','','GREAT!','EXCELLENT!','AMAZING!','UNBELIEVABLE!','UNBELIEVABLE!'][Math.min(out.lines,6)],label=out.perfect?'PERFECT CLEAR!':out.combo>1?`COMBO ${out.combo}${praise?` · ${praise}`:''}`:praise;if(label){cb.effect(label,'blocks',{lines:out.lines,combo:out.combo,perfect:out.perfect,points:out.points});shown=true;}}newBest(shown);cb.progress?.({lines:state.lines});afterAction();}
 // Clear effects, modelled on Block Blast: every cleared block bursts (a flash, then it shrinks away and throws
 // shards), sweeping out from where the piece landed; the points for the move float up from the cleared lines; and the
 // piece just placed settles with a small bounce. Purely visual: it never touches the game state.
 const motion=options.motion!==false;
 function layer(){let el=root.querySelector('.blast-layer');if(!el){el=document.createElement('div');el.className='blast-layer';el.setAttribute('aria-hidden','true');root.append(el);}return el;}
 function landed(p,r,c,out){if(!motion)return;const gone=new Set(out.cleared.map(([rr,cc])=>rr*8+cc));for(const [x,y]of p.shape){const i=(r+y)*8+c+x;if(gone.has(i))continue;board.querySelector(`[data-cell="${i}"]`)?.animate([{transform:'scale(.82)'},{transform:'scale(1.06)',offset:.6},{transform:'scale(1)'}],{duration:220,easing:'ease-out'});}}
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
 const LIFT_CELLS=1.75,TAP_SLOP=6;
 let drag=null,dragArt=null,suppressClick=false;
 const buzz=ms=>{try{navigator.vibrate?.(ms);}catch{}};
 function boardMetrics(){const a=board.querySelector('[data-cell="0"]').getBoundingClientRect(),b=board.querySelector('[data-cell="1"]').getBoundingClientRect();return {cell:a.width,step:b.left-a.left,left:a.left,top:a.top};}
 function clearDrag(){dragArt?.remove();dragArt=null;tray.querySelector('.lifted')?.classList.remove('lifted');drag=null;board.querySelectorAll('.ghost,.clear-preview').forEach(b=>b.classList.remove('ghost','clear-preview'));}
 function liftPiece(){const m=boardMetrics(),art=tray.querySelector(`[data-shape="${drag.index}"] .shape-preview`);if(!art)return;
  dragArt=art.cloneNode(true);dragArt.classList.add('block-drag-preview');dragArt.style.setProperty('--cell',`${m.cell}px`);dragArt.style.setProperty('--gap',`${m.step-m.cell}px`);root.append(dragArt);
  tray.querySelector(`[data-shape="${drag.index}"]`)?.classList.add('lifted');buzz(8);}
 function follow(e){if(!dragArt)return;const m=boardMetrics(),p=state.tray[drag.index];if(!p)return;
  const cols=Math.max(...p.shape.map(s=>s[0]))+1,rows=Math.max(...p.shape.map(s=>s[1]))+1,w=cols*m.step-(m.step-m.cell),h=rows*m.step-(m.step-m.cell);
  const left=e.clientX-w/2,top=e.clientY-drag.lift*m.step-h/2;
  dragArt.style.left=`${left}px`;dragArt.style.top=`${top}px`;
  drag.r=Math.round((top-m.top)/m.step);drag.c=Math.round((left-m.left)/m.step);
  drag.valid=fits(state.grid,p.shape,drag.r,drag.c);dragArt.classList.toggle('invalid',!drag.valid);
  if(drag.valid)preview(drag.r,drag.c);else board.querySelectorAll('.ghost,.clear-preview').forEach(b=>b.classList.remove('ghost','clear-preview'));}
 const dragDown=e=>{const slot=e.target.closest('[data-shape]');if(locked()||!slot||!state.tray[slot.dataset.shape])return;
  drag={index:Number(slot.dataset.shape),x:e.clientX,y:e.clientY,moving:false,lift:e.pointerType==='touch'?LIFT_CELLS:0};tray.setPointerCapture?.(e.pointerId);
  state.selected=drag.index;bomb=false;hintCells=[];liftPiece();follow(e);cb.sound('select');};
 const dragMove=e=>{if(!drag||locked())return;if(!drag.moving&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>=TAP_SLOP)drag.moving=true;follow(e);};
 const dragUp=e=>{if(!drag)return;follow(e);const last=drag;clearDrag();if(!last.moving){render();return;} // a tap: the click handler selects it
  suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
  if(locked())return;if(last.valid){buzz(12);place(last.r,last.c);}else{render();cb.sound('invalid');cb.message('That spot is taken. The piece is back in the tray.');}};
 const dragCancel=()=>clearDrag();const dragClick=e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}};
 for(const [name,handler] of [['pointerdown',dragDown],['pointermove',dragMove],['pointerup',dragUp],['pointercancel',dragCancel]])tray.addEventListener(name,handler);tray.addEventListener('click',dragClick,true);
 buttons.bomb.onclick=()=>{if(locked()||!tools.bomb)return;bomb=!bomb;hintCells=[];hud();cb.sound('tool');cb.message(bomb?'Tap a square to clear its surrounding 3 × 3 area.':'Select a piece to keep playing.');};
 buttons.undo.onclick=()=>{if(locked()||!blocksUndo(g))return;state=g.state;bomb=false;hintCells=[];render();cb.sound('undo');cb.message('Last move restored.');afterAction();};
 buttons.shuffle.onclick=()=>{if(locked()||!blocksShuffle(g))return;state=g.state;bomb=false;hintCells=[];render();cb.sound('tool');cb.message('Three fresh pieces. Find a new fit.');afterAction();};
 buttons.hint.onclick=()=>{if(locked()||!tools.hint)return;const best=blocksHint(g);if(!best){cb.sound('invalid');cb.message('Try Bomb or Shuffle to make space.');return;}state=g.state;bomb=false;hintCells=best.shape.map(([x,y])=>[best.r+y,best.c+x]);render();cb.sound('hint');cb.message(`Place piece ${best.i+1} at row ${best.r+1}, column ${best.c+1}.`);};
 function finish(){if(ended||!alive)return;ended=true;hud();cb.end(blocksResult(g));}
 render();cb.message('Drag a piece onto the board, or tap a piece then its top-left square.');return {pause(value=true){paused=value;clearDrag();hud();},finish,destroy(){alive=false;clearDrag();for(const [name,handler] of [['pointerdown',dragDown],['pointermove',dragMove],['pointerup',dragUp],['pointercancel',dragCancel]])tray.removeEventListener(name,handler);tray.removeEventListener('click',dragClick,true);},action(){}};
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
