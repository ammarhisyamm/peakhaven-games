// Readable, live help for the three client games. Boards and scoring stay in their engines.
import {crystalSprites} from './gameplay-art.js';
import {INTRO_KEY,obstacleIntros,obstacleCards,rememberIntros,levelGoalCard} from './sequence-intro.js';
export const iceIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 5 5 7-3 6m3-6 6 3M5 19h14"/></svg>';
export const lockIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';
const goalIcon=kind=>kind==='ice'?iceIcon:kind==='lock'?lockIcon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 3 6 6 1-4.5 4.5 1 6-5.5-3-5.5 3 1-6L3 10l6-1z"/></svg>';
export function renderSequenceGoals(root,{version,level,goals},onHelp,onObstacleHelp){
 const el=root.querySelector('#sequence-goals');if(!el)return;el.hidden=version===1;
 if(!el.firstChild)el.innerHTML='<div class="sequence-goal-heading"><strong></strong><span class="sequence-heading-actions"><button type="button" class="sequence-what" aria-label="What do ice and traps mean?">?</button><button type="button" class="sequence-help">How to play</button></span></div><div class="sequence-goal-list"></div>';
 el.querySelector('.sequence-help').onclick=onHelp;
 // The "?" only earns its place on a level that actually has ice or traps to explain.
 const what=el.querySelector('.sequence-what'),cards=obstacleCards(goals);
 what.hidden=!cards.length;what.onclick=()=>onObstacleHelp?.(cards);
 el.querySelector('.sequence-goal-heading>strong').textContent=`Level ${level} goals`;
 const list=el.querySelector('.sequence-goal-list');list.replaceChildren();
 for(const goal of goals){
  const item=document.createElement('div');item.className=`sequence-goal${goal.left?'':' is-complete'}`;
  const art=document.createElement('span');art.className=`goal-symbol goal-${goal.kind}`;
  if(goal.kind==='collect'){const img=document.createElement('img');img.src=`assets/gameplay/${crystalSprites[goal.type]}.webp`;img.alt='';art.append(img);}else art.innerHTML=goalIcon(goal.kind);
  const copy=document.createElement('span'),name=document.createElement('span'),value=document.createElement('strong');
  name.className='goal-name';name.textContent=goal.kind==='score'?'Reach score':goal.kind==='ice'?'Break ice':goal.kind==='lock'?'Free crystals':`Collect ${goal.label.replace(/ crystals?$/i,'')}`;
  const number=n=>n>=10000?new Intl.NumberFormat('en-AU',{notation:'compact',maximumFractionDigits:1}).format(n):n.toLocaleString('en-AU');
  // A finished goal is ticked rather than spelled out: it reads at a glance and leaves the numbers big.
  value.textContent=goal.left?`${number(goal.done)} / ${number(goal.total)}`:`✓ ${number(goal.total)}`;
  copy.append(name,value);item.append(art,copy);
  item.setAttribute('aria-label',`${name.textContent}: ${goal.left?`${goal.done} of ${goal.total}`:`done, all ${goal.total}`}`);list.append(item);
 }
 const guide=root.querySelector('.sequence-guide');if(!guide)return;guide.replaceChildren();
 const add=(symbol,title,text)=>{const p=document.createElement('p'),art=document.createElement('span'),copy=document.createElement('span'),b=document.createElement('strong');art.className='guide-symbol';art.innerHTML=symbol;b.textContent=title+':';copy.append(b,document.createTextNode(' '+text));p.append(art,copy);guide.append(p);};
 // The same wording as the "What's this?" cards, so the reminder matches what the player was taught.
 for(const card of obstacleCards(goals))add(card.kind==='ice'?iceIcon:lockIcon,card.title,card.line);
 if(!guide.children.length)add(goalIcon('score'),'Make a match','Swap neighbours to line up 3 crystals. Match 4 for a line blast.');
 root.style.setProperty('--sequence-goal-rows',Math.ceil(goals.length/2));
}
// The card that opens a level: big, centred, and gone after a couple of seconds or the first tap.
// Resolves when it leaves, so the obstacle explanation can follow it rather than land on top of it.
const GOAL_CARD_MS=2000;
const partIcon=part=>part.kind==='ice'?iceIcon:part.kind==='lock'?lockIcon
 :part.kind==='moves'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>'
 :part.kind==='collect'&&crystalSprites[part.type]?`<img src="assets/gameplay/${crystalSprites[part.type]}.webp" alt="">`
 :goalIcon('score');
export function showSequenceGoalCard(root,{level,goals,moves},{motion=true,hold=GOAL_CARD_MS}={}){
 root.querySelector('.sequence-level-card')?.remove();
 const card=levelGoalCard(level,goals,moves);
 const el=document.createElement('div');el.className='sequence-level-card';el.setAttribute('role','status');
 if(!motion)el.dataset.still='true';
 el.innerHTML=`<div class="level-card-body"><strong>${card.title}</strong><ul>${card.parts.map(p=>`<li><span class="level-card-icon">${partIcon(p)}</span>${p.text}</li>`).join('')}</ul></div>`;
 el.setAttribute('aria-label',card.text);
 root.append(el);
 return new Promise(resolve=>{
  let done=false;
  const leave=()=>{if(done)return;done=true;clearTimeout(timer);el.removeEventListener('pointerdown',leave);el.remove();resolve();};
  el.addEventListener('pointerdown',leave);
  const timer=setTimeout(leave,hold);
 });
}

// "What's this?" for ice and traps. Shown once per device the first time a level has them, and
// re-openable from the "?" on the goal panel. The pictures are the board's own tiles, so what the
// card explains is what the player is looking at.
const obstacleArt=kind=>kind==='ice'
 ? `<span class="obstacle-tile is-ice"><img src="assets/gameplay/${crystalSprites[0]}.webp" alt=""><i>2</i></span>`
 : `<span class="obstacle-tile is-lock"><img src="assets/gameplay/${crystalSprites[3]}.webp" alt=""><i>${lockIcon}</i></span>`;
export function showObstacleIntro(root,cards,onClose){
 if(!cards.length||root.querySelector('.obstacle-intro'))return null;
 const previous=document.activeElement;
 const el=document.createElement('section');el.className='obstacle-intro';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','obstacle-intro-title');
 el.innerHTML=`<div class="obstacle-intro-card"><h2 id="obstacle-intro-title">What's this?</h2>${cards.map(c=>
  `<div class="obstacle-row">${obstacleArt(c.kind)}<p><strong>${c.title}:</strong> ${c.line}</p></div>`).join('')}<button type="button" class="button" data-got-it>Got it</button></div>`;
 root.append(el);
 const close=()=>{el.remove();previous?.focus?.({preventScroll:true});onClose?.();};
 el.querySelector('[data-got-it]').onclick=close;
 el.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
 el.querySelector('[data-got-it]').focus({preventScroll:true});
 return el;
}

// Reading and writing the per-device seen-list. Storage can throw or come back empty in a private
// window, which only means the cards are offered again: never a reason to fail the level opening.
export function seenObstacles(store=globalThis.localStorage){
 try{const raw=store?.getItem(INTRO_KEY);const list=raw?JSON.parse(raw):[];return Array.isArray(list)?list:[];}catch{return [];}
}
export function rememberObstacles(shown,store=globalThis.localStorage){
 try{store?.setItem(INTRO_KEY,JSON.stringify(rememberIntros(seenObstacles(store),shown)));}catch{}
}
// Everything a level opening does, in order: the goal card, then any explanation this device is owed.
export async function openSequenceLevel(root,payload,{motion=true,store=globalThis.localStorage}={}){
 await showSequenceGoalCard(root,payload,{motion});
 const owed=obstacleIntros(payload.goals,seenObstacles(store));
 if(!owed.length)return;
 rememberObstacles(owed,store);
 showObstacleIntro(root,owed);
}

export function renderRidgeCheckpoint(root,checkpoint,gates){
 let el=root.querySelector('.ridge-route');if(!el){el=document.createElement('div');el.className='ridge-route';el.innerHTML='<div><strong></strong><span></span></div><progress max="50" aria-label="Gates until the next colour checkpoint"></progress>';root.append(el);}
 el.querySelector('strong').textContent=checkpoint.name;
 el.querySelector('span').textContent=`Next colour at ${checkpoint.next} gates`;
 const progress=el.querySelector('progress');progress.value=gates-checkpoint.from;progress.setAttribute('aria-valuetext',`${gates-checkpoint.from} of 50 gates to the next colour`);
 el.dataset.stage=checkpoint.stage;
}
// The offer after the first crash. It counts down from five and ends the run on its own if nobody
// answers, so a player who has put the phone down is not left staring at a frozen crash.
export const RESCUE_SECONDS=5;
export function showRidgeRescue(root,engine,{seconds=RESCUE_SECONDS}={}){
 if(root.querySelector('.ridge-rescue'))return;
 const previous=document.activeElement,el=document.createElement('section');el.className='ridge-rescue';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','ridge-rescue-title');
 el.innerHTML=`<div class="ridge-rescue-card"><h2 id="ridge-rescue-title">Revive?</h2><p>Your score stays. You start again in a safe gap with a short shield.</p><strong>One free revive per run</strong><button type="button" class="button" data-revive>Revive <span class="rescue-count" aria-hidden="true">${seconds}</span></button><button type="button" class="button secondary" data-finish>End run</button><p class="rescue-countdown" role="timer" aria-live="polite">Ending in ${seconds} seconds</p></div>`;
 root.classList.add('ridge-rescuing');root.append(el);
 let left=seconds,timer=0;
 const close=()=>{clearInterval(timer);el.remove();root.classList.remove('ridge-rescuing');previous?.focus?.({preventScroll:true});};
 timer=setInterval(()=>{
  left--;
  if(left<=0){close();engine.finish();return;}
  el.querySelector('.rescue-count').textContent=left;
  el.querySelector('.rescue-countdown').textContent=`Ending in ${left} ${left===1?'second':'seconds'}`;
 },1000);
 el.querySelector('[data-revive]').onclick=()=>{if(engine.revive()){close();root.querySelector('canvas')?.focus({preventScroll:true});}};
 el.querySelector('[data-finish]').onclick=()=>{close();engine.finish();};
 el.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();engine.finish();}if(e.key==='Tab'){const buttons=[...el.querySelectorAll('button')],first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
 el.querySelector('[data-revive]').focus({preventScroll:true});
}
