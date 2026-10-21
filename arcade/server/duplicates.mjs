// Accounts that might be the same person twice, from what the arcade already knows about them.
//
// This is a reading aid and nothing else. It never blocks a signup, never flags a run and never touches a
// board — it puts names next to each other on the admin page so that whoever is about to post a prize can
// see that two of them arrived on the same invite code ninety seconds apart. Judging it is a person's job.
//
// Only three things are used, all of them already stored and none of them gathered for this: the invite
// code the account joined on, when it joined, and its email address. Nothing is inferred from a device, an
// address or a network.
import {COMPETITION} from './competition.mjs';

// Two signups closer together than this, on the same code, are worth showing side by side.
export const SIGNUP_WINDOW_SECONDS=30*60;

// The same mailbox, written differently. Plus-addressing (`billy+arcade@`) is delivered to `billy@`, and
// Gmail also ignores dots in the local part, so three spellings can be one inbox — and Supabase treats each
// as a separate user, which is the gap this closes.
//
// Deliberately display-only: plus-addressing is a legitimate thing people do to sort their mail, so a match
// here is a prompt to look, never grounds to refuse an account.
const DOTLESS_DOMAINS=new Set(['gmail.com','googlemail.com']);
export function normaliseEmail(email){
  const raw=String(email??'').trim().toLowerCase();
  const at=raw.lastIndexOf('@');
  if(at<1)return raw;
  let local=raw.slice(0,at);
  const domain=raw.slice(at+1);
  const plus=local.indexOf('+');
  if(plus>0)local=local.slice(0,plus);
  if(DOTLESS_DOMAINS.has(domain))local=local.replace(/\./g,'');
  return `${local}@${domain}`;
}

const seconds=value=>{const t=Date.parse(value??'');return Number.isFinite(t)?t/1000:null;};

// One player as the panel shows them: who they are, when they arrived, and what they have actually played,
// so a cluster of accounts that have never scored reads differently from one that is winning things.
function member(player,emails,totals){
  const best=Object.fromEntries(COMPETITION.games.map(game=>[game,totals.get(`${player.id}|${game}`)?.best??0]));
  const runs=COMPETITION.games.reduce((sum,game)=>sum+(totals.get(`${player.id}|${game}`)?.runs??0),0);
  return {player_id:player.id,name:player.name??'Player',email:emails.get(player.id)??null,
    inviteCode:player.invite_code??null,joinedAt:player.created_at??null,runs,best};
}

// Same code, and signups close enough together to be one sitting. Chained rather than compared against the
// first of the group, so four accounts made ten minutes apart stay one cluster instead of splitting at the
// half hour.
function byInviteCode(players,emails,totals,windowSeconds){
  const codes=new Map();
  for(const player of players){
    const code=player.invite_code;
    if(!code)continue;
    if(!codes.has(code))codes.set(code,[]);
    codes.get(code).push(player);
  }
  const out=[];
  for(const [code,group] of codes){
    const dated=group.filter(p=>seconds(p.created_at)!==null)
      .sort((a,b)=>seconds(a.created_at)-seconds(b.created_at));
    let cluster=[];
    const flush=()=>{
      if(cluster.length>1){
        const span=seconds(cluster.at(-1).created_at)-seconds(cluster[0].created_at);
        out.push({kind:'invite-code',key:code,code,spanSeconds:Math.max(0,Math.round(span)),
          members:cluster.map(p=>member(p,emails,totals))});
      }
      cluster=[];
    };
    for(const player of dated){
      if(!cluster.length||seconds(player.created_at)-seconds(cluster.at(-1).created_at)<=windowSeconds)cluster.push(player);
      else{flush();cluster=[player];}
    }
    flush();
  }
  return out;
}

// The same mailbox under different spellings. No time window: two accounts on one inbox are worth seeing
// however far apart they were made.
function byEmail(players,emails,totals){
  const groups=new Map();
  for(const player of players){
    const email=emails.get(player.id);
    if(!email)continue;
    const key=normaliseEmail(email);
    if(!key||!key.includes('@'))continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(player);
  }
  return [...groups].filter(([,group])=>group.length>1).map(([key,group])=>({
    kind:'email',key,mailbox:key,
    members:group.map(p=>member(p,emails,totals))
      .sort((a,b)=>String(a.joinedAt??'').localeCompare(String(b.joinedAt??''))),
  }));
}

// Both checks, tightest cluster first so the most suspicious thing is at the top. A pair caught by both
// shows up twice on purpose: they are two different reasons to look, and collapsing them would hide one.
export function duplicateGroups({players=[],emails=new Map(),totals=new Map(),windowSeconds=SIGNUP_WINDOW_SECONDS}={}){
  const emailMap=emails instanceof Map?emails:new Map(Object.entries(emails));
  const totalMap=totals instanceof Map?totals:new Map(Object.entries(totals));
  const invite=byInviteCode(players,emailMap,totalMap,windowSeconds);
  const mailbox=byEmail(players,emailMap,totalMap);
  return [...invite.sort((a,b)=>a.spanSeconds-b.spanSeconds||a.code.localeCompare(b.code)),
    ...mailbox.sort((a,b)=>b.members.length-a.members.length||a.key.localeCompare(b.key))];
}

// Keyed the way the panel wants them: `${player_id}|${game}` -> {runs, best}.
export const totalsIndex=rows=>new Map((rows??[]).map(r=>[`${r.player_id}|${r.game}`,
  {runs:Math.max(0,Number(r.runs)||0),best:Math.max(0,Number(r.best)||0)}]));
