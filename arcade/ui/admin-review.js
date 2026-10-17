// The review side of the admin page: the runs a verification flagged or an admin has already rejected, and
// the invite codes.
//
// Clearing a flag leaves the run counting; rejecting it takes the score off every board and needs a note
// saying why. Both go through /api/admin, both are logged with the admin's email, and both are safe to click
// twice: the server only changes a run that is not already in that state.
//
// admin.js owns the page and redraws it whole, so this module only builds markup and wires the buttons it
// just drew, the same way admin-coins.js does.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');

export const ACTION_LABELS={run_clear_flag:'Flag cleared',run_reject:'Run rejected',
  invite_create:'Code created',invite_max_uses:'Uses changed'};
export const actionLabel=action=>ACTION_LABELS[action]??String(action??'');

export const STATE_FILTERS=[['','Flagged and rejected'],['flagged','Flagged only'],['rejected','Rejected only']];

// Nothing here can be logged before supabase/admin-log.sql has run, so the lists still show but the buttons
// are off and say why, rather than making a change nobody could trace afterwards.
function migrationNotice(ready){
  if(ready!==false)return '';
  return `<p class="admin-note bad">Reviewing runs and changing invite codes is not set up on this deployment yet. Run <b>arcade/supabase/admin-log.sql</b> in the Supabase SQL editor, then reload this page. Until then everything below is read-only, because an action that cannot be logged is not worth doing.</p>`;
}

function filters(review,busy){
  const games=[['','Every game'],...review.games.map(g=>[g.game,g.label])];
  const option=([value,label],selected)=>`<option value="${escape(value)}"${value===(selected??'')?' selected':''}>${escape(label)}</option>`;
  return `<div class="admin-controls">
    <label class="admin-field"><span>Game</span><select id="review-game"${busy?' disabled':''}>${games.map(g=>option(g,review.game)).join('')}</select></label>
    <label class="admin-field"><span>Showing</span><select id="review-state"${busy?' disabled':''}>${STATE_FILTERS.map(s=>option(s,review.state)).join('')}</select></label>
  </div>`;
}

// A flagged run says what was claimed against what the replay produced, once flag-details.sql has run. On a
// deployment it has not reached, both are null and the fixed sentence is shown exactly as before.
export function reasonLine(run){
  if(run.status==='rejected')return escape(run.reason);
  if(run.claimedScore==null||run.verifiedScore==null)return escape(run.reason);
  return `Claimed ${fmt(run.claimedScore)} · Verified ${fmt(run.verifiedScore)}`;
}

// A month that was finalised before one of its runs was rejected. The podium everybody can see is left as it
// was on purpose, so this says what changed and leaves the decision to an admin.
export function staleBanner(review){
  if(!review?.stale?.length)return '';
  return review.stale.map(s=>{
    const moves=s.movesUp.map(m=>`${escape(m.name)} would move up${m.from?` from ${place(m.from)}`:' onto the podium'} to ${place(m.to)}`).join('. ');
    return `<p class="admin-note bad stale-month">A run in ${escape(s.gameLabel)} for ${escape(s.monthLabel)} was rejected after finalising, so its archived podium no longer matches the runs. The board still shows ${escape(s.archivedWinner??'nobody')}. ${moves?moves+'. ':''}Review it and click <b>Finalise again</b> for ${escape(s.monthLabel)}.</p>`;
  }).join('');
}
const place=n=>n===1?'1st':n===2?'2nd':n===3?'3rd':`${n}th`;

function runRows(review,busy){
  if(!review.runs.length)return '<p class="admin-hint">Nothing to review in this month.</p>';
  const off=busy||review.ready===false;
  return `<ol class="admin-list review">${review.runs.map(r=>`<li class="${r.status==='rejected'?'is-rejected':'is-flagged'}">
    <span class="admin-game">${escape(r.gameLabel)}</span>
    <div><strong>${escape(r.name)}</strong><small>${escape(r.email||'no email on file')}</small></div>
    <span class="admin-score">${fmt(r.score)}</span>
    <span class="admin-day">${escape(r.day)}</span>
    <span class="admin-status ${r.status==='rejected'?'rejected':'flagged'}">${r.status==='rejected'?'Rejected · not counting':'Flagged · still counting'}</span>
    <small class="admin-reason">${reasonLine(r)}</small>
    ${r.status==='rejected'?'':`<span class="admin-row-actions">
      <input type="text" class="review-note" data-note="${escape(r.id)}" maxlength="200" placeholder="Why, if rejecting"${off?' disabled':''}>
      ${r.flagged?`<button class="secondary" data-review="${escape(r.id)}" data-action="clear-flag"${off?' disabled':''}>Clear flag</button>`:''}
      <button class="primary" data-review="${escape(r.id)}" data-action="reject"${off?' disabled':''}>Reject</button>
    </span>`}
  </li>`).join('')}</ol>
  <p class="admin-hint">Clearing a flag leaves the score on the boards. Rejecting takes it off and needs a note. If the month has already been finalised, its podium is written again straight away.</p>`;
}

function inviteRows(invites,busy){
  const off=busy||invites.ready===false;
  if(!invites.list.length)return '<p class="admin-hint">No invite codes yet.</p>';
  return `<ol class="admin-list invites">${invites.list.map(c=>`<li${c.uses>=c.max_uses?' class="is-used-up"':''}>
    <span class="admin-reference">${escape(c.code)}</span>
    <span class="admin-pack">${fmt(c.uses)} of ${fmt(c.max_uses)} used</span>
    <div><small>${escape(c.note||'no note')}</small></div>
    <span class="admin-row-actions">
      <input type="number" class="invite-max" data-max="${escape(c.code)}" min="1" max="10000" step="1" value="${escape(c.max_uses)}" inputmode="numeric"${off?' disabled':''}>
      <button class="secondary" data-invite="${escape(c.code)}" data-action="invite-max-uses"${off?' disabled':''}>Change uses</button>
    </span>
  </li>`).join('')}</ol>`;
}

function inviteForm(invites,busy){
  const off=busy||invites.ready===false;
  return `<div class="admin-adjust">
    <label class="admin-field"><span>New code</span><input type="text" id="invite-code" maxlength="32" placeholder="PEAK-FRIENDS"${off?' disabled':''}></label>
    <label class="admin-field"><span>Max uses</span><input type="number" id="invite-uses" min="1" max="10000" step="1" value="1" inputmode="numeric"${off?' disabled':''}></label>
    <label class="admin-field wide"><span>Note</span><input type="text" id="invite-note" maxlength="120" placeholder="Handed out at the Melbourne pop-up"${off?' disabled':''}></label>
    <button class="secondary" id="invite-create"${off?' disabled':''}>Create code</button>
    <p class="admin-hint">Letters, numbers and dashes. A code that already exists is left exactly as it is, so creating it twice changes nothing.</p>
  </div>`;
}

function actionRows(actions){
  if(!actions?.length)return '<p class="admin-hint">Nothing has been reviewed yet.</p>';
  return `<ol class="admin-list ledger">${actions.map(a=>`<li>
    <span class="admin-reason">${escape(actionLabel(a.action))}</span>
    <div><strong>${escape(a.invite_code||a.details?.game||'run')}</strong><small>${escape(a.note||'no note')}</small></div>
    <span class="admin-age">${escape(a.admin_email||'automatic')}</span>
  </li>`).join('')}</ol>`;
}

// The three panels, for admin.js to drop into the page it is drawing.
export function reviewPanels(view,busy=false){
  if(!view?.review)return '';
  return `<section class="panel admin-review"><h2>Runs to review</h2>
      <p>A run is flagged when the score a browser sent does not match the score its replay produces. It keeps counting until somebody decides otherwise.</p>
      ${migrationNotice(view.review.ready)}
      ${staleBanner(view.review)}
      ${filters(view.review,busy)}
      ${runRows(view.review,busy)}
    </section>
    <section class="panel"><h2>Invite codes</h2>${inviteRows(view.invites,busy)}${inviteForm(view.invites,busy)}</section>
    <section class="panel"><h2>Recent admin actions</h2>${actionRows(view.actions)}</section>`;
}

// Wires the buttons the markup above just drew. `act` runs one admin call and is given back the new view;
// `filter` reloads the page with a different game or state.
export function bindReview(root,{act,filter}){
  root.querySelectorAll('[data-review]').forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.review;
      const note=root.querySelector(`[data-note="${CSS.escape(id)}"]`)?.value??'';
      act({action:button.dataset.action,id,note});
    };
  });
  root.querySelectorAll('[data-invite]').forEach(button=>{
    button.onclick=()=>{
      const code=button.dataset.invite;
      const maxUses=Number(root.querySelector(`[data-max="${CSS.escape(code)}"]`)?.value);
      act({action:'invite-max-uses',code,maxUses});
    };
  });
  const create=root.querySelector('#invite-create');
  if(create)create.onclick=()=>act({action:'invite-create',
    code:root.querySelector('#invite-code')?.value??'',
    maxUses:Number(root.querySelector('#invite-uses')?.value),
    note:root.querySelector('#invite-note')?.value??''});
  const game=root.querySelector('#review-game'),state=root.querySelector('#review-state');
  if(game)game.onchange=()=>filter({game:game.value,state:state?.value??''});
  if(state)state.onchange=()=>filter({game:game?.value??'',state:state.value});
}

// What to say once an action has gone through, so the page reports what actually happened rather than just
// "done": a second click on Reject changes nothing, and a rejection says whether a podium was rewritten.
export function reviewMessage(action,result){
  if(action==='clear-flag')return result?.changed?'Flag cleared. The score keeps counting.':'That run was not flagged.';
  if(action==='reject'){
    if(!result?.changed)return 'That run was already rejected.';
    if(!result.needsRefinalise)return 'Run rejected. It no longer counts.';
    return `Run rejected. It no longer counts. ${result.needsRefinalise.month} was already finalised, so its podium is unchanged until you click Finalise again.`;
  }
  if(action==='invite-create')return result?.created
    ? `${result.code} created, good for ${fmt(result.max_uses)} use${result.max_uses===1?'':'s'}.`
    : `${result?.code} already exists and was left as it is: ${fmt(result?.uses)} of ${fmt(result?.max_uses)} used.`;
  if(action==='invite-max-uses')return result?.changed
    ? `${result.code} now allows ${fmt(result.max_uses)} use${result.max_uses===1?'':'s'}.`
    : `${result?.code} already allowed that many uses.`;
  return 'Done.';
}
