// The money side of the admin page: purchases waiting for a bank transfer, marking one paid (which is what
// grants the coins), cancelling or refunding one, handing coins out or taking them back by hand, and the
// ledger so every one of those shows who did it.
//
// admin.js owns the page and redraws it whole, so this module only builds markup and wires the buttons it
// just drew. Everything it does goes through /api/purchase and /api/coins, which are admin-only and
// idempotent: a second click on "Mark paid" cannot grant the coins twice.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');

export const PROVIDER_LABELS={manual:'bank transfer / PayID',stripe:'Stripe (not switched on)'};
export const providerLabel=id=>PROVIDER_LABELS[id]??String(id??'none');

// "4 minutes", "3 hours", "2 days": how long a player has been waiting to be matched off the bank feed.
export function ageLabel(minutes){
  const m=Math.max(0,Math.round(Number(minutes)||0));
  if(m<1)return 'just now';
  if(m<60)return `${m} minute${m===1?'':'s'}`;
  const h=Math.round(m/60);
  if(h<48)return `${h} hour${h===1?'':'s'}`;
  return `${Math.round(h/24)} days`;
}
const statusLabel=status=>({pending:'Waiting for payment',paid:'Paid',cancelled:'Cancelled',refunded:'Refunded'}[status]??String(status??''));
const signed=delta=>`${Number(delta)>0?'+':''}${Number(delta)||0}`;

// Nothing on this page can work before supabase/paid-tries.sql has run, and the page says so rather than
// offering buttons that would fail.
function migrationNotice(view){
  if(view?.ready!==false)return '';
  return `<p class="admin-note bad">Paid extra tries are not set up on this deployment yet. Run <b>arcade/supabase/paid-tries.sql</b> in the Supabase SQL editor, then reload this page. Until then nobody has coins, the shop stays hidden and everything else runs normally.</p>`;
}
function paymentNotice(view){
  if(view?.ready===false)return '';
  if(view?.paymentReady)return `<p class="admin-hint">Payments: ${escape(providerLabel(view.provider))}. The shop is open.</p>`;
  return `<p class="admin-note bad">The shop is hidden because this deployment has no payment details. Set <b>ARCADE_PAY_ACCOUNT_NAME</b> and either <b>ARCADE_PAY_BSB</b> + <b>ARCADE_PAY_ACCOUNT_NUMBER</b> or <b>ARCADE_PAY_PAYID</b>. Coins already handed out can still be spent.</p>`;
}

function pendingRows(view,busy){
  if(view.ready===false)return '';
  if(!view.pending?.length)return '<p class="admin-hint">Nothing is waiting for payment.</p>';
  return `<ol class="admin-list purchases">${view.pending.map(row=>`<li>
    <span class="admin-reference">${escape(row.reference)}</span>
    <div><strong>${escape(row.name)}</strong><small>${escape(row.email||'no email on file')}</small></div>
    <span class="admin-pack">${fmt(row.coins)} coin${row.coins===1?'':'s'} · ${escape(row.price)}</span>
    <span class="admin-age">waiting ${escape(ageLabel(row.ageMinutes))}</span>
    <span class="admin-row-actions">${view.needsAdminConfirmation?`<button class="primary" data-purchase="${escape(row.id)}" data-action="paid"${busy?' disabled':''}>Mark paid</button>`:''}<button class="secondary" data-purchase="${escape(row.id)}" data-action="cancel"${busy?' disabled':''}>Cancel</button></span>
  </li>`).join('')}</ol>
  <p class="admin-hint">Marking a purchase paid grants its coins. It is safe to click twice: the coins are only ever granted once.</p>`;
}

function settledRows(view,busy){
  if(view.ready===false||!view.settled?.length)return '';
  return `<section class="panel"><h2>Recent purchases</h2>
    <ol class="admin-list purchases settled">${view.settled.map(row=>`<li>
      <span class="admin-reference">${escape(row.reference)}</span>
      <div><strong>${escape(row.name)}</strong><small>${escape(row.email||'no email on file')}</small></div>
      <span class="admin-pack">${fmt(row.coins)} coin${row.coins===1?'':'s'} · ${escape(row.price)}</span>
      <span class="admin-status ${escape(row.status)}">${escape(statusLabel(row.status))}</span>
      <span class="admin-row-actions">${row.status==='paid'?`<button class="secondary" data-purchase="${escape(row.id)}" data-action="refund"${busy?' disabled':''}>Refund</button>`:''}</span>
    </li>`).join('')}</ol>
    <p class="admin-hint">A refund takes back whatever of that purchase&rsquo;s coins are unspent, and the runs its spent coins paid for stop counting on the leaderboards.</p></section>`;
}

function adjustForm(view,busy){
  if(view.ready===false)return '';
  if(!view.players?.length)return '<p class="admin-hint">No players yet.</p>';
  return `<div class="admin-adjust">
    <label class="admin-field"><span>Player</span><select id="coin-player">${view.players.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}${p.email?` · ${escape(p.email)}`:''} · ${fmt(p.coins)} coin${p.coins===1?'':'s'}</option>`).join('')}</select></label>
    <label class="admin-field"><span>Coins</span><input type="number" id="coin-delta" step="1" min="-500" max="500" value="1" inputmode="numeric"></label>
    <label class="admin-field wide"><span>Note (required)</span><input type="text" id="coin-note" maxlength="200" placeholder="Paid by card at the shop"></label>
    <button class="secondary" id="coin-adjust"${busy?' disabled':''}>Apply</button>
    <p class="admin-hint">A positive number gives coins, a negative one takes them back. A balance never goes below zero, and the note and your email are kept with it.</p>
  </div>`;
}

function ledgerRows(view){
  if(view.ready===false)return '';
  if(!view.ledger?.length)return '<p class="admin-hint">No coins have moved yet.</p>';
  return `<ol class="admin-list ledger">${view.ledger.map(row=>`<li>
    <span class="admin-delta ${Number(row.delta)<0?'out':Number(row.delta)>0?'in':''}">${escape(signed(row.delta))}</span>
    <div><strong>${escape(row.name)}</strong><small>${escape(row.note||row.reason)}</small></div>
    <span class="admin-reason">${escape(row.reason)}</span>
    <span class="admin-age">${escape(row.admin_email||'automatic')}</span>
  </li>`).join('')}</ol>`;
}

// The three panels, for admin.js to drop into the page it is drawing.
export function coinsPanels(view,busy=false){
  if(!view)return '';
  return `<section class="panel admin-coins"><h2>Extra tries</h2>
      <p>One coin buys one extra run of any game, once that game&rsquo;s three free tries for the day are gone.</p>
      ${migrationNotice(view)}${paymentNotice(view)}
      <h3>Waiting for payment</h3>${pendingRows(view,busy)}
    </section>
    ${settledRows(view,busy)}
    <section class="panel"><h2>Coins by hand</h2>${adjustForm(view,busy)}</section>
    <section class="panel"><h2>Recent coin activity</h2>${ledgerRows(view)}</section>`;
}

// Wires the buttons the markup above just drew. `act` runs one admin call and is given back the new view.
export function bindCoins(root,{act}){
  root.querySelectorAll('[data-purchase]').forEach(button=>{
    button.onclick=()=>act('purchase',{id:button.dataset.purchase,action:button.dataset.action});
  });
  const apply=root.querySelector('#coin-adjust');
  if(apply)apply.onclick=()=>{
    const player=root.querySelector('#coin-player')?.value;
    const delta=Number(root.querySelector('#coin-delta')?.value);
    const note=root.querySelector('#coin-note')?.value??'';
    act('coins',{player,delta,note});
  };
}

// What to say once an action has gone through, so the page reports what actually happened rather than just
// "done": granting twice grants nothing, and a refund says how much came back and how many runs it dropped.
export function actionMessage(action,result){
  if(action==='purchase'||action==='paid'){
    if(result?.refunded!==undefined)return result.refunded
      ? `Refunded ${result.removed} unspent coin${result.removed===1?'':'s'} and dropped ${result.runs} paid run${result.runs===1?'':'s'} from the boards.`
      : `Nothing to refund: that purchase is ${statusLabel(result.status).toLowerCase()}.`;
    if(result?.cancelled!==undefined)return result.cancelled
      ? `${result.reference} cancelled. No coins were granted.`
      : `Nothing to cancel: that purchase is ${statusLabel(result.status).toLowerCase()}.`;
    if(result?.granted!==undefined)return result.granted
      ? `${result.reference} paid. ${fmt(result.coins)} coin${result.coins===1?'':'s'} added, balance ${fmt(result.balance)}.`
      : `Already granted. The balance is still ${fmt(result.balance)}.`;
  }
  if(action==='adjust'||action==='coins'){
    if(!result?.delta)return `No change. The balance is still ${fmt(result?.balance)}.`;
    return `${signed(result.delta)} coin${Math.abs(result.delta)===1?'':'s'}. The balance is now ${fmt(result.balance)}.`;
  }
  return 'Done.';
}
