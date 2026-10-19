// Readable, live help for the three client games. Boards and scoring stay in their engines.
import {crystalSprites} from './gameplay-art.js';
export const iceIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 5 5 7-3 6m3-6 6 3M5 19h14"/></svg>';
export const lockIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';
const goalIcon=kind=>kind==='ice'?iceIcon:kind==='lock'?lockIcon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 3 6 6 1-4.5 4.5 1 6-5.5-3-5.5 3 1-6L3 10l6-1z"/></svg>';
export function renderSequenceGoals(root,{version,level,goals},onHelp){
 const el=root.querySelector('#sequence-goals');if(!el)return;el.hidden=version===1;
 if(!el.firstChild){el.innerHTML='<div class="sequence-goal-heading"><strong></strong><button type="button" class="sequence-help">How to play</button></div><div class="sequence-goal-list"></div>';el.querySelector('button').onclick=onHelp;}
 el.querySelector('strong').textContent=`Level ${level} goals`;
 const list=el.querySelector('.sequence-goal-list');list.replaceChildren();
 for(const goal of goals){
  const item=document.createElement('div');item.className=`sequence-goal${goal.left?'':' is-complete'}`;
  const art=document.createElement('span');art.className=`goal-symbol goal-${goal.kind}`;
  if(goal.kind==='collect'){const img=document.createElement('img');img.src=`assets/gameplay/${crystalSprites[goal.type]}.webp`;img.alt='';art.append(img);}else art.innerHTML=goalIcon(goal.kind);
  const copy=document.createElement('span'),name=document.createElement('span'),value=document.createElement('strong');
  name.className='goal-name';name.textContent=goal.kind==='score'?'Reach score':goal.kind==='ice'?'Break ice':goal.kind==='lock'?'Open locks':`Collect ${goal.label.replace(/ crystals?$/i,'')}`;
  const number=n=>n>=10000?new Intl.NumberFormat('en-AU',{notation:'compact',maximumFractionDigits:1}).format(n):n.toLocaleString('en-AU');
  value.textContent=goal.left?`${number(goal.done)} / ${number(goal.total)}`:'Complete';
  copy.append(name,value);item.append(art,copy);item.setAttribute('aria-label',`${name.textContent}: ${goal.done} of ${goal.total}`);list.append(item);
 }
 const guide=root.querySelector('.sequence-guide');if(!guide)return;guide.replaceChildren();
 const add=(symbol,title,text)=>{const p=document.createElement('p'),art=document.createElement('span'),copy=document.createElement('span'),b=document.createElement('strong');art.className='guide-symbol';art.innerHTML=symbol;b.textContent=title+':';copy.append(b,document.createTextNode(' '+text));p.append(art,copy);guide.append(p);};
 if(goals.some(g=>g.kind==='ice'))add(iceIcon,'Ice','Match on or beside it. Each rim needs one hit.');
 if(goals.some(g=>g.kind==='lock'))add(lockIcon,'Locks','Match beside a lock to free its crystal.');
 if(!guide.children.length)add(goalIcon('score'),'Make a match','Swap neighbours to line up 3 crystals. Match 4 for a line blast.');
 root.style.setProperty('--sequence-goal-rows',Math.ceil(goals.length/2));
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
