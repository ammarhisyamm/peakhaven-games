// What to look at before a prize goes out, next to the button that publishes the month.
//
// A month's podium is three rows a game, and until now the admin page showed a name and a number. That is
// not enough to decide anything: the thing worth knowing about a winning run is how long it took, how many
// inputs it took, whether anything flagged it, and above all whether its stored replay still produces the
// score on the board. All of that is here, and Re-verify re-plays the replay on demand.
//
// Nothing on this panel changes a run. Re-verify asks a question and prints the answer.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');
const place=n=>n===1?'1st':n===2?'2nd':n===3?'3rd':`${n}th`;

const MARK={ok:'✓',warn:'!',action:'·'};
// The word for each status, so the mark is never the only thing carrying the meaning.
const STATUS_WORD={ok:'Looks fine',warn:'Worth a look',action:'Needs checking'};

// One line of the checklist, with whatever the stored run can already say about it. `action` means the
// answer is not knowable from what is stored — press the button.
export function checklistMarkup(checklist){
  if(!checklist?.length)return '';
  return `<ol class="winner-checklist">${checklist.map(item=>`<li data-check="${escape(item.key)}" data-status="${escape(item.status)}">
    <span class="check-mark" aria-hidden="true">${MARK[item.status]??'·'}</span>
    <span class="check-label">${item.label}</span>
    <small class="check-detail"><span class="visually-hidden">${escape(STATUS_WORD[item.status]??'')}. </span>${escape(item.detail)}</small>
  </li>`).join('')}</ol>`;
}

// The numbers that say whether a run was played by a person: how long it was open by the server's clock,
// how long it lasted in game time, and how many inputs it took. Peak Blocks has no clock in its replay, so
// its game time is reported as absent rather than as zero.
function runFacts(row){
  const parts=[`${fmt(row.moves)} input${row.moves===1?'':'s'}`];
  if(row.wallClock)parts.push(`${escape(row.wallClock)} start to finish`);
  parts.push(row.gameSeconds==null?'no game clock in this replay':`${fmt(row.gameSeconds)} s of game time`);
  if(row.segments>1)parts.push(`${fmt(row.segments)} levels`);
  return parts.join(' · ');
}

function podiumRow(row,busy){
  const flags=(row.reasons??[]).filter(r=>r?.text);
  return `<li class="${row.winner?'is-winner':''}" data-rank="${escape(row.rank)}">
    <span class="admin-rank">${place(row.rank)}</span>
    <div><strong>${escape(row.name)}</strong><small>${escape(row.email||'no email on file')}</small></div>
    <span class="admin-score">${fmt(row.score)}</span>
    <small class="admin-reason">${runFacts(row)}</small>
    ${flags.length?`<ul class="admin-reasons">${flags.map(r=>`<li data-flag="${escape(r.code)}">${escape(r.text)}</li>`).join('')}</ul>`:''}
    ${row.duplicate?`<small class="admin-reason bad">${escape(row.duplicate)}</small>`:''}
    ${row.runId?`<span class="admin-row-actions">
      <button class="secondary" data-reverify="${escape(row.runId)}"${busy?' disabled':''}>Re-verify</button>
    </span>`:'<small class="admin-hint">No stored run behind this row.</small>'}
    ${row.winner?checklistMarkup(row.checklist):''}
  </li>`;
}

export function winnerPanels(view,busy=false){
  const winners=view?.winners;
  if(!winners?.games?.length)return '';
  const any=winners.games.some(g=>g.podium.length);
  if(!any)return `<section class="panel admin-winners"><h2>Before paying a prize</h2>
    <p class="admin-hint">Nothing on the board for ${escape(winners.month)} yet.</p></section>`;
  return `<section class="panel admin-winners"><h2>Before paying a prize</h2>
    <p>Each game&rsquo;s top three for ${escape(winners.month)}, with the run behind the row. First place wins; second and third are kept as backups in case a winner&rsquo;s run is disqualified. The checklist under each winner says what the stored run can already answer; Re-verify re-plays the replay and reports whether it still produces that score.</p>
    ${winners.finalised?'':`<p class="admin-hint">This month is not finalised yet, so these are worked out live from the runs and can still change.</p>`}
    ${winners.games.map(g=>`<div class="winner-game" data-game="${escape(g.game)}">
      <h3>${escape(g.label)}</h3>
      ${g.podium.length?`<ol class="admin-list winners">${g.podium.map(r=>podiumRow(r,busy)).join('')}</ol>`
        :'<p class="admin-hint">Nobody has scored in this game this month.</p>'}
    </div>`).join('')}</section>`;
}

// Wires the Re-verify buttons this panel drew. `act` runs one admin call and is handed the new view back,
// the same contract admin-review.js and admin-coins.js use.
export function bindWinners(root,{act}){
  root.querySelectorAll('[data-reverify]').forEach(button=>{
    button.onclick=()=>act({action:'re-verify',id:button.dataset.reverify});
  });
}
