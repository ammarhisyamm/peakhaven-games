// Reviewing runs and handing out invite codes, both behind the one admin route.
//
// A run is flagged when the score a browser sent does not match its replay. Clearing the flag leaves the run
// counting; rejecting it takes the score off every board and needs a note. Invite codes can be created and
// their uses changed. Every action is admin-only, logged with that admin's email, and safe to click twice.
// Uses the in-memory store and auth, so no network and no database are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');
const {AdminLogNotReady}=await import('../arcade/server/competition.mjs');

const SECRET='test-secret',ADMIN='boss@peak.test';

// October 2026, so September is a finished month that can be finalised.
function world(start='2026-10-14T01:00:00Z'){
  let t=Date.parse(start);const now=()=>new Date(t);
  const store=createMemoryStore({invites:{TEAM:20},now}),auth=createMemoryAuth();
  const api=createHandlers({store,auth,secret:SECRET,now,admins:[ADMIN]});
  let n=0;
  return {store,auth,api,now,
    async join(email,name){
      const r=await api.join({body:{email,name,code:'TEAM'},origin:'https://example.test'});
      assert.equal(r.status,200,JSON.stringify(r.body));
      return {token:auth.tokenFor(email),id:[...auth.users.values()].find(u=>u.email===email).id,email,name};
    },
    // A finished run straight into the store: reviewing only ever reads scores, never replays.
    score(player,game,score,{day='2026-10-10',flagged=false}={}){
      const id=`run-${++n}`;
      store.runs.set(id,{id,player_id:player.id,game,day,score,status:'closed',segments:1,flagged,
        reject_reason:null,paid:false,updated_at:`${day}T0${n%9}:00:00Z`,finished_at:`${day}T0${n%9}:00:00Z`});
      return id;
    },
    async adminToken(){await this.join(ADMIN,'Boss');return auth.tokenFor(ADMIN);},
    view(token,query){return api.admin({token,query,method:'GET'});},
    act(token,body){return api.admin({token,body,method:'POST'});}};
}

// A deployment that has not run arcade/supabase/admin-log.sql.
const withoutLog=store=>({...store,async adminLogReady(){return false;},
  async reviewRun(){throw new AdminLogNotReady();},
  async createInvite(){throw new AdminLogNotReady();},
  async setInviteMaxUses(){throw new AdminLogNotReady();},
  async adminActions(){return [];}});

test('Only an admin can see the review, clear a flag, reject a run or change an invite code',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'blocks',900,{flagged:true});

  assert.equal((await w.view(player.token)).status,403,'a player cannot see the admin view');
  assert.equal((await w.view(null)).status,401,'and neither can a stranger');
  for(const body of [{action:'clear-flag',id:runId},{action:'reject',id:runId,note:'Not a real score'},
    {action:'invite-create',code:'NEW-CODE',maxUses:1},{action:'invite-max-uses',code:'TEAM',maxUses:2}]){
    assert.equal((await w.act(player.token,body)).status,403,`a player cannot ${body.action}`);
  }
  // Nothing a player tried changed anything.
  assert.equal(w.store.runs.get(runId).flagged,true);
  assert.equal(w.store.adminEntries.length,0);
  assert.equal((await w.view(token)).status,200);
});

test('A flagged run is listed with who played it, and clearing the flag leaves it counting',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'blocks',900,{flagged:true});

  const before=await w.view(token,{month:'2026-10'});
  assert.equal(before.status,200);
  const listed=before.body.review.runs.find(r=>r.id===runId);
  assert.ok(listed,'the flagged run is on the list');
  assert.equal(listed.name,'Player');
  assert.equal(listed.email,'player@peak.test');
  assert.equal(listed.game,'blocks');
  assert.equal(listed.score,900);
  assert.equal(listed.flagged,true);
  assert.equal(listed.counts,true,'a flagged run still counts');
  assert.match(listed.reason,/did not match/i,'it says why it was flagged');

  const cleared=await w.act(token,{action:'clear-flag',id:runId});
  assert.equal(cleared.status,200,JSON.stringify(cleared.body));
  assert.equal(cleared.body.result.changed,true);
  assert.equal(w.store.runs.get(runId).flagged,false);
  // Clearing a flag never takes a score off the boards.
  assert.equal((await w.store.scoredRuns('2026-10-01','2026-10-31')).some(r=>r.id===runId),true);
  // It is off the review list now, and the action is logged against the admin who did it.
  assert.equal((await w.view(token,{month:'2026-10'})).body.review.runs.some(r=>r.id===runId),false);
  assert.deepEqual(w.store.adminEntries.map(a=>[a.action,a.admin_email]),[['run_clear_flag',ADMIN]]);
});

test('Clearing a flag twice changes nothing and is logged once',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'blocks',900,{flagged:true});

  const first=await w.act(token,{action:'clear-flag',id:runId});
  const second=await w.act(token,{action:'clear-flag',id:runId});
  assert.equal(first.body.result.changed,true);
  assert.equal(second.status,200);
  assert.equal(second.body.result.changed,false,'the second click changes nothing');
  assert.equal(w.store.adminEntries.length,1,'and is not logged a second time');
});

test('Rejecting a run needs a note, stops it counting, and a second click changes nothing',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'ridge',700,{flagged:true});

  const noNote=await w.act(token,{action:'reject',id:runId});
  assert.equal(noNote.status,400,'a rejection without a note is refused');
  assert.match(noNote.body.error,/note/i);
  assert.equal(w.store.runs.get(runId).status,'closed','and nothing was rejected');

  const rejected=await w.act(token,{action:'reject',id:runId,note:'Replay does not reach that score'});
  assert.equal(rejected.status,200,JSON.stringify(rejected.body));
  assert.equal(rejected.body.result.changed,true);
  const stored=w.store.runs.get(runId);
  assert.equal(stored.status,'rejected');
  assert.equal(stored.reject_reason,'Replay does not reach that score');
  assert.equal(stored.flagged,false,'a rejected run is no longer waiting to be looked at');
  assert.equal((await w.store.scoredRuns('2026-10-01','2026-10-31')).some(r=>r.id===runId),false,'it stops counting');

  const again=await w.act(token,{action:'reject',id:runId,note:'Same again'});
  assert.equal(again.body.result.changed,false);
  assert.equal(w.store.runs.get(runId).reject_reason,'Replay does not reach that score','the first note is kept');
  assert.deepEqual(w.store.adminEntries.map(a=>a.action),['run_reject']);

  // A rejected run stays on the list, so the decision can be seen and checked afterwards.
  const listed=(await w.view(token,{month:'2026-10'})).body.review.runs.find(r=>r.id===runId);
  assert.equal(listed.status,'rejected');
  assert.equal(listed.counts,false);
  assert.equal(listed.reason,'Replay does not reach that score');
});

test('An unknown run is reported rather than silently doing nothing',async()=>{
  const w=world();
  const token=await w.adminToken();
  const missing=await w.act(token,{action:'clear-flag',id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(missing.status,404);
  assert.equal((await w.act(token,{action:'clear-flag'})).status,400,'and so is no run at all');
});

test('Rejecting a run in a finalised month writes that month\'s podium again',async()=>{
  const w=world();
  const token=await w.adminToken();
  const cheat=await w.join('cheat@peak.test','Cheat');
  const honest=await w.join('honest@peak.test','Honest');
  const cheated=w.score(cheat,'ridge',9000,{day:'2026-09-10',flagged:true});
  w.score(honest,'ridge',800,{day:'2026-09-11'});

  const finalised=await w.api.finalise({token,body:{month:'2026-09'}});
  assert.equal(finalised.status,200,JSON.stringify(finalised.body));
  assert.deepEqual(finalised.body.winners.map(r=>r.name),['Cheat'],'the top score wins before review');

  const rejected=await w.act(token,{action:'reject',id:cheated,note:'Score does not match the replay'});
  assert.equal(rejected.status,200,JSON.stringify(rejected.body));
  assert.equal(rejected.body.result.recomputed,'2026-09','the finalised month is worked out again');

  const after=await w.api.results({token,query:{month:'2026-09'}});
  assert.deepEqual(after.body.winners.map(r=>r.name),['Honest'],'the podium now reflects the rejection');
});

test('A rejection in a month nobody has finalised rewrites nothing',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'ridge',700,{day:'2026-09-10'});
  const rejected=await w.act(token,{action:'reject',id:runId,note:'Not a real score'});
  assert.equal(rejected.body.result.recomputed,null);
  assert.equal(w.store.results.size,0,'no month was archived by a rejection');
});

test('The review list can be narrowed to one game, or to flagged or rejected',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const blocks=w.score(player,'blocks',900,{flagged:true});
  const ridge=w.score(player,'ridge',700,{flagged:true});
  const sequence=w.score(player,'sequence',600,{flagged:true});
  await w.act(token,{action:'reject',id:sequence,note:'Not a real score'});
  // A run with nothing wrong with it is never on the list.
  const clean=w.score(player,'blocks',100);

  const ids=async query=>(await w.view(token,{month:'2026-10',...query})).body.review.runs.map(r=>r.id).sort();
  assert.deepEqual(await ids(),[blocks,ridge,sequence].sort(),'everything worth a look, and nothing else');
  assert.equal((await ids()).includes(clean),false);
  assert.deepEqual(await ids({game:'blocks'}),[blocks]);
  assert.deepEqual(await ids({state:'flagged'}),[blocks,ridge].sort());
  assert.deepEqual(await ids({state:'rejected'}),[sequence]);
  assert.deepEqual(await ids({game:'ridge',state:'flagged'}),[ridge]);
  // A month with nothing in it is empty rather than an error.
  assert.deepEqual(await ids({month:'2026-08'}),[]);
});

test('An invite code can be made once, and making it again leaves it exactly as it was',async()=>{
  const w=world();
  const token=await w.adminToken();

  const made=await w.act(token,{action:'invite-create',code:'peak-friends',maxUses:20,note:'Pop-up'});
  assert.equal(made.status,200,JSON.stringify(made.body));
  assert.equal(made.body.result.created,true);
  assert.equal(made.body.result.code,'PEAK-FRIENDS','a code is stored the way it is typed in');
  assert.equal(await w.store.inviteAvailable('PEAK-FRIENDS'),true,'and it works straight away');

  const again=await w.act(token,{action:'invite-create',code:'PEAK-FRIENDS',maxUses:9999,note:'Something else'});
  assert.equal(again.body.result.created,false);
  assert.equal((await w.store.listInvites()).find(c=>c.code==='PEAK-FRIENDS').max_uses,20,'it was not widened');
  assert.equal((await w.store.listInvites()).find(c=>c.code==='PEAK-FRIENDS').note,'Pop-up','or reworded');
  assert.deepEqual(w.store.adminEntries.map(a=>a.action),['invite_create'],'and only the first is logged');
});

test('How many times a code may be used can be changed, once',async()=>{
  const w=world();
  const token=await w.adminToken();

  const changed=await w.act(token,{action:'invite-max-uses',code:'TEAM',maxUses:50});
  assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.equal(changed.body.result.changed,true);
  assert.equal(changed.body.result.max_uses,50);
  assert.equal((await w.view(token)).body.invites.list.find(c=>c.code==='TEAM').max_uses,50);

  const same=await w.act(token,{action:'invite-max-uses',code:'TEAM',maxUses:50});
  assert.equal(same.body.result.changed,false,'setting it to what it already is changes nothing');
  assert.deepEqual(w.store.adminEntries.map(a=>a.action),['invite_max_uses'],'and is logged once');

  assert.equal((await w.act(token,{action:'invite-max-uses',code:'NOPE',maxUses:5})).status,404);
  for(const maxUses of [0,-1,1.5,'lots',100000]){
    assert.equal((await w.act(token,{action:'invite-create',code:'X-CODE',maxUses})).status,400,`${maxUses} is not a number of uses`);
  }
  assert.equal((await w.act(token,{action:'invite-create',code:'!!!',maxUses:1})).status,400,'and a code needs some letters');
});

test('Without the admin log table everything still shows, but nothing can be changed',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'blocks',900,{flagged:true});
  // Rebuild the API over a store that has no admin_log, as a deployment that has not run the migration.
  const api=createHandlers({store:withoutLog(w.store),auth:w.auth,secret:SECRET,now:w.now,admins:[ADMIN]});

  const view=await api.admin({token,query:{month:'2026-10'},method:'GET'});
  assert.equal(view.status,200,'the page still loads');
  assert.equal(view.body.review.ready,false,'and says the migration has not run');
  assert.equal(view.body.invites.ready,false);
  assert.equal(view.body.review.runs.length,1,'the lists are still there to look at');
  assert.ok(view.body.invites.list.length);

  for(const body of [{action:'clear-flag',id:runId},{action:'reject',id:runId,note:'Not a real score'},
    {action:'invite-create',code:'NEW-CODE',maxUses:1},{action:'invite-max-uses',code:'TEAM',maxUses:2}]){
    const out=await api.admin({token,body,method:'POST'});
    assert.equal(out.status,503,`${body.action} is refused`);
    assert.match(out.body.error,/admin-log\.sql/,'and says what to run');
  }
  assert.equal(w.store.runs.get(runId).flagged,true,'nothing was changed');
});

test('Everything an admin does goes through one route, and /api/money still reaches it',async()=>{
  const w=world();
  const token=await w.adminToken();
  const player=await w.join('player@peak.test','Player');
  const runId=w.score(player,'blocks',900,{flagged:true});

  // One GET carries the money, the runs to review, the codes and the log.
  const view=await w.view(token,{month:'2026-10'});
  for(const key of ['pending','players','ledger','review','invites','actions'])assert.ok(key in view.body,`the view carries ${key}`);

  // The old path is the same handler.
  const old=await w.api.money({token,query:{month:'2026-10'},method:'GET'});
  assert.equal(old.status,200);
  assert.deepEqual(old.body.review.runs.map(r=>r.id),[runId]);
  const acted=await w.api.money({token,body:{action:'clear-flag',id:runId},method:'POST'});
  assert.equal(acted.status,200,JSON.stringify(acted.body));
  assert.equal(acted.body.result.changed,true);

  // An action answers with the whole page worked out again, so no panel is left stale.
  assert.ok('review' in acted.body&&'invites' in acted.body&&'pending' in acted.body);
  assert.equal(acted.body.review.runs.length,0,'the run it just cleared is gone from the list');
  assert.equal(acted.body.actions[0].action,'run_clear_flag','and the log already shows it');

  assert.equal((await w.act(token,{})).status,400,'an action has to say which one');
  assert.equal((await w.act(token,{action:'nonsense',id:runId})).status,400);
});
