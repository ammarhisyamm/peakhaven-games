// Accounts that might be the same person twice, on the admin page.
//
// This panel is a reading aid and says so on its face. It does not block anything, it does not flag a run,
// and being in a group here is not evidence of anything — plus-addressing is a normal way to sort mail, and
// two friends signing up together on one code is exactly what a shared code is for. What it is good for is
// the moment before a prize goes out, when "these two joined on the same code ninety seconds apart" is
// worth knowing.
//
// admin.js owns the page and redraws it whole, so this module only builds markup.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('en-AU');

// "3 Oct, 7:42 pm" — enough to see that two signups were minutes apart.
export function signupTime(value){
  const t=Date.parse(value??'');
  if(!Number.isFinite(t))return 'unknown';
  return new Date(t).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',
    timeZone:'Australia/Melbourne'});
}
// "within 2 min" reads better than a span of 0 seconds for two accounts made in the same minute.
export const spanText=seconds=>{
  const s=Math.max(0,Math.round(Number(seconds)||0));
  if(s<60)return `within ${s} s`;
  const minutes=Math.round(s/60);
  return `within ${minutes} min`;
};

export function groupTitle(group){
  if(group.kind==='invite-code')
    return `${group.members.length} accounts on <b>${escape(group.code)}</b>, ${escape(spanText(group.spanSeconds))} of each other`;
  return `${group.members.length} accounts on one mailbox: <b>${escape(group.mailbox)}</b>`;
}

// What each account has actually played, which is how a cluster worth worrying about is told from one that
// is not: three accounts that have never scored are a person trying the invite twice, not a prize problem.
function memberRow(member,games){
  const best=games.map(g=>`${escape(g.label)} ${fmt(member.best?.[g.game])}`).join(' · ');
  return `<li>
    <div><strong>${escape(member.name)}</strong><small>${escape(member.email||'no email on file')}</small></div>
    <span class="admin-day">${escape(signupTime(member.joinedAt))}</span>
    <span class="admin-pack">${fmt(member.runs)} run${member.runs===1?'':'s'}</span>
    <small class="admin-reason">${best||'nothing played yet'}</small>
  </li>`;
}

export function duplicatePanel(view,games){
  const duplicates=view?.duplicates;
  if(!duplicates)return '';
  const list=duplicates.groups??[];
  const body=list.length
    ? `<ol class="admin-list duplicates">${list.map(group=>`<li class="duplicate-group" data-kind="${escape(group.kind)}">
        <p class="duplicate-title">${groupTitle(group)}</p>
        <ul class="admin-list">${group.members.map(m=>memberRow(m,games)).join('')}</ul>
      </li>`).join('')}</ol>`
    : `<p class="admin-hint">Nothing to look at: no invite code was used twice within half an hour, and no two accounts share a mailbox.</p>`;
  return `<section class="panel admin-duplicates"><h2>Possible duplicate accounts</h2>
    <p>Two checks over the ${fmt(duplicates.players)} accounts: signups on the same invite code within half an hour of each other, and addresses that reach one mailbox (<code>name+tag@</code> is the same inbox as <code>name@</code>, and Gmail ignores dots). An account can appear under both.</p>
    <p class="admin-hint">This is here to be read, not acted on automatically. Nothing below is blocked, flagged or stopped from playing, and sharing a code or tagging an address is not by itself a problem — it is worth knowing before a prize goes out.</p>
    ${body}</section>`;
}
