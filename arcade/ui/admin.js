// Running the competition at the end of a month. Signed in as a listed admin (ARCADE_ADMIN_EMAILS), you can
// check a finished month's podium, write the prize line for each game, and finalise the results.
// Finalising archives the top three of each game and marks the winners: first place only, so three a month.
// Second and third are kept as backups in case a winner's run is disqualified during review.
// The same page also runs the money behind paid extra tries, which lives in admin-coins.js.
import {initAccount} from './account.js';
import {PRIZE_FALLBACK,prizeLine,winnerEmails,monthLabel,monthName} from './month-prizes.js';
import {coinsPanels,bindCoins,actionMessage} from './admin-coins.js';

const $=s=>document.querySelector(s),main=$('#main');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');
const GAMES=['blocks','sequence','ridge'];

let account,view=null,month=null,busy=false,note='',noteKind='',coins=null;

function say(message,kind=''){note=message;noteKind=kind;render();}

// Purchases, balances and the ledger, loaded alongside the month's results and reloaded after every action,
// because each action answers with the new state of all three.
async function loadCoins(){
  const r=await account.api('money');
  coins=r.ok?r:null;
  if(!r.ok&&r.status!==403)note=note||r.error||'Extra tries could not load.';
}

// One admin action on the money: mark paid, cancel, refund, or an adjustment by hand. Each answers with the
// refreshed view, so the page always shows what the database now says rather than what was clicked.
async function act(body){
  busy=true;render();
  const r=await account.api('money',{body});
  busy=false;
  if(!r.ok)return say(r.error||'That did not go through.','bad');
  coins=r;
  say(actionMessage(r.action,r.result),'good');
}

// The twelve months up to this one. The current month can be looked at but not finalised.
function monthOptions(thisMonth){
  const [y,m]=String(thisMonth||'').split('-').map(Number);
  if(!y||!m)return [];
  const out=[];
  for(let i=0;i<12;i++){const d=new Date(Date.UTC(y,m-1-i,1));out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`);}
  return out;
}

async function load(next){
  busy=true;render();
  const [r]=await Promise.all([account.api('results',{query:next?{month:next}:undefined}),loadCoins()]);
  busy=false;
  if(!r.ok){view=null;say(r.error||'Monthly results could not load.','bad');return;}
  view=r;month=r.month;note='';noteKind='';render();
}

// Writing the month's podium: the three winners are marked, which is what sends their prize message and puts
// the podium on the boards. Running it again replaces that month's rows, for a disqualification during review.
async function finalise(){
  // Read the fields before rendering: drawing the busy state replaces them.
  const target=view.month,prizes=readPrizes();
  busy=true;render();
  const r=await account.api('finalise',{body:{month:target,prizes}});
  busy=false;
  if(!r.ok)return say(r.error||'That did not go through.','bad');
  view=r;month=r.month;
  say(`${monthLabel(r.month)} is finalised. ${r.winners.length} winner${r.winners.length===1?'':'s'} marked.`,'good');
}

// Prize text on its own, which tells nobody anything and finalises nothing.
async function savePrizes(){
  const target=view.month,prizes=readPrizes();
  busy=true;render();
  const r=await account.api('finalise',{body:{prizes}});
  busy=false;
  if(!r.ok)return say(r.error||'That did not go through.','bad');
  await load(target);
  say('Prize text saved.','good');
}

const notReady=()=>view&&view.ready===false;
function migrationNotice(){
  if(!notReady())return '';
  return `<p class="admin-note bad">The monthly results tables are not set up on this deployment yet. Run <b>arcade/supabase/month-end.sql</b> in the Supabase SQL editor, then reload this page. Until then the arcade runs normally, every board shows the default prize line, and last month&rsquo;s winners stay hidden.</p>`;
}
function prizeInputs(){
  return `<div class="admin-prizes">${view.games.map(g=>`<label class="admin-field"><span>${escape(g.label)}</span><input type="text" maxlength="120" data-prize="${g.game}" value="${escape(g.text)}" placeholder="${escape(PRIZE_FALLBACK)}"${notReady()?' disabled':''}></label>`).join('')}
    <p class="admin-hint">One line per game, for first place. Left blank, a board shows &ldquo;${escape(PRIZE_FALLBACK)}&rdquo;.</p>
    <button class="secondary" id="save-prizes"${busy||notReady()?' disabled':''}>Save prize text</button></div>`;
}

function winnerRows(){
  if(!view.winners.length)return '<p class="admin-hint">No scores in this month, so there is nothing to award.</p>';
  return `<ol class="admin-list winners">${view.winners.map(r=>`<li><span class="admin-game">${escape(r.gameLabel)}</span><div><strong>${escape(r.name)}</strong><small>${escape(r.email||'no email on file')}</small></div><span class="admin-score">${fmt(r.score)}</span></li>`).join('')}</ol>
    <div class="admin-actions"><button class="secondary" id="copy-emails">Copy winner emails</button><span class="admin-hint">${view.winners.length} winner${view.winners.length===1?'':'s'}: 1st place in each game.</span></div>`;
}

function backupRows(){
  if(!view.backups.length)return '';
  return `<section class="panel"><h2>Backups</h2><p class="admin-hint">2nd and 3rd place, archived for last month&rsquo;s podium. They win no prize. Use them if a winner&rsquo;s run is disqualified during review, then finalise again.</p>
    <ol class="admin-list backups">${view.backups.map(r=>`<li><span class="admin-game">${escape(r.gameLabel)}</span><span class="admin-place">${r.rank===2?'2nd':'3rd'}</span><div><strong>${escape(r.name)}</strong><small>${escape(r.email||'no email on file')}</small></div><span class="admin-score">${fmt(r.score)}</span></li>`).join('')}</ol></section>`;
}

function render(){
  if(!account?.enabled){main.innerHTML='<section class="panel"><h2>Accounts are off</h2><p>This deployment has no competition API, so there are no monthly results to run.</p></section>';return;}
  if(!account.signedIn()){
    main.innerHTML=`<section class="panel"><h2>Sign in to run the competition</h2><p>Use the email that is listed as an admin.</p>
      <form id="signin" class="admin-signin"><label class="admin-field"><span>Email</span><input type="email" id="email" autocomplete="email" required></label><button class="primary" type="submit">Send sign-in link</button></form>
      ${note?`<p class="admin-note ${noteKind}">${escape(note)}</p>`:''}<p class="admin-hint"><a class="text-link" href="index.html#play">Back to the arcade</a></p></section>`;
    $('#signin').onsubmit=async e=>{
      e.preventDefault();
      const r=await account.signIn($('#email').value);
      say(r.ok?'Check your email for the sign-in link.':r.error||'That did not go through.',r.ok?'good':'bad');
    };
    return;
  }
  if(!view){
    main.innerHTML=`<section class="panel"><h2>Monthly results</h2><p>${busy?'Loading…':escape(note||'Nothing loaded yet.')}</p>${busy?'':'<button class="secondary" id="reload">Try again</button>'}</section>${coinsPanels(coins,busy)}`;
    if(!busy)$('#reload').onclick=()=>load(month);
    bindCoins(main,{act});
    return;
  }
  const finalisedSet=new Set(view.finalisedMonths||[]);
  const options=monthOptions(view.thisMonth).map(m=>`<option value="${m}"${m===view.month?' selected':''}>${escape(monthLabel(m))}${finalisedSet.has(m)?' · finalised':''}</option>`).join('');
  main.innerHTML=`
    <section class="panel admin-head">
      <h2>End of month</h2>
      <p>Three prizes a month: whoever tops Peak Blocks, whoever tops Sequence, whoever tops Ridge Run.</p>
      <div class="admin-controls">
        <label class="admin-field"><span>Month</span><select id="month">${options}</select></label>
        <button class="primary" id="finalise"${busy||!view.finished||notReady()?' disabled':''}>${view.finalised?'Finalise again':'Finalise'} ${escape(monthName(view.month))}</button>
      </div>
      ${migrationNotice()}
      <p class="admin-state ${view.finalised?'good':''}">${view.finalised?`Finalised${view.finalisedAt?` ${escape(new Date(view.finalisedAt).toLocaleString('en-AU'))}`:''}. Winners are marked, so they see their prize message and the boards show this podium.`:view.finished?`Not finalised yet. The podium below is worked out live from ${escape(monthName(view.month))}&rsquo;s runs, and nobody has been told anything.`:'This month is still being played. You can look, but not finalise.'}</p>
      ${note?`<p class="admin-note ${noteKind}">${escape(note)}</p>`:''}
    </section>
    <section class="panel"><h2>Prize text</h2>${prizeInputs()}</section>
    <section class="panel"><h2>Winners</h2>${winnerRows()}</section>
    ${backupRows()}
    ${coinsPanels(coins,busy)}
    <section class="panel"><h2>Every podium</h2>${view.games.map(g=>`<div class="admin-game-block"><h3>${escape(g.label)}</h3><p class="admin-hint">${escape(prizeLine({[g.game]:g.text},g.game))}</p><ol class="admin-list">${g.podium.length?g.podium.map(r=>`<li><span class="admin-place">${r.rank===1?'1st':r.rank===2?'2nd':'3rd'}</span><div><strong>${escape(r.name)}</strong><small>${r.winner?'Winner':'Runner-up'}</small></div><span class="admin-score">${fmt(r.score)}</span></li>`).join(''):'<li class="admin-hint">No scores.</li>'}</ol></div>`).join('')}</section>`;

  $('#month').onchange=e=>load(e.target.value);
  const finaliseButton=$('#finalise'),saveButton=$('#save-prizes');
  if(finaliseButton)finaliseButton.onclick=finalise;
  if(saveButton)saveButton.onclick=savePrizes;
  const copy=$('#copy-emails');
  if(copy)copy.onclick=()=>copyEmails(winnerEmails(view.winners));
  bindCoins(main,{act});
}

const readPrizes=()=>Object.fromEntries(GAMES.map(game=>[game,main.querySelector(`[data-prize="${game}"]`)?.value??'']));

// Only first places are copied: second and third win nothing, so they must not end up in the prize email.
async function copyEmails(text){
  if(!text)return say('No winner has an email on file.','bad');
  const count=text.split(', ').length;
  // In a window that does not have focus the clipboard promise can hang, so give it a moment and then fall
  // back rather than leave the button looking dead.
  const wrote=await Promise.race([
    Promise.resolve(navigator.clipboard?.writeText(text)).then(()=>true,()=>false),
    new Promise(resolve=>setTimeout(()=>resolve(false),1200)),
  ]);
  if(wrote)return say(`Copied ${count} winner email${count===1?'':'s'}.`,'good');
  const box=document.createElement('textarea');
  box.value=text;box.setAttribute('readonly','');box.style.position='fixed';box.style.opacity='0';
  document.body.append(box);box.select();
  let done=false;try{done=document.execCommand('copy');}catch{}
  box.remove();
  say(done?`Copied ${count} winner email${count===1?'':'s'}.`:`Copy did not work. The addresses are: ${text}`,done?'good':'bad');
}

try{account=await initAccount();}catch{account={enabled:true,signedIn:()=>false,api:async()=>({ok:false,error:'Sign-in could not load. Refresh to try again.'}),signIn:async()=>({ok:false,error:'Sign-in could not load. Refresh to try again.'}),onChange(){}};}
account.onChange?.(()=>{view=null;coins=null;if(account.signedIn())load(month);else render();});
if(account.enabled&&account.signedIn())await load();
render();
