// End of month: the top three of each game are archived, but only first place wins a prize, so a month has
// three winners. Second and third are kept as backups for review and are told nothing. Uses the in-memory
// store and auth, so no network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
const {monthPodium,monthResults,previousMonth,cleanMonth,cleanPrize,monthKey}=await import('../arcade/server/competition.mjs');
const {PRIZE_FALLBACK,prizeLine,winnerModal,winnerEmails,gameLabel,monthLabel}=await import('../arcade/ui/month-prizes.js');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');

const SECRET='test-secret',ADMIN='boss@peak.test';

// A world whose clock sits in October, so September is the month to finalise.
function world(start='2026-10-14T01:00:00Z'){
  let t=Date.parse(start);const now=()=>new Date(t);
  const store=createMemoryStore({invites:{TEAM:20},now}),auth=createMemoryAuth();
  const api=createHandlers({store,auth,secret:SECRET,now,admins:[ADMIN]});
  let n=0;
  return {store,auth,api,now,advance:s=>{t+=s*1000;},
    async join(email,name){
      const r=await api.join({body:{email,name,code:'TEAM'},origin:'https://example.test'});
      assert.equal(r.status,200,JSON.stringify(r.body));
      const user=[...auth.users.values()].find(u=>u.email===email);
      return {token:auth.tokenFor(email),id:user.id,email,name};
    },
    // A verified run straight into the store: this month-end flow only reads scores, never replays.
    score(player,game,score,day='2026-09-10'){
      const id=`run-${++n}`;
      store.runs.set(id,{id,player_id:player.id,game,day,score,status:'closed',segments:1,flagged:false,updated_at:`${day}T0${n%9}:00:00Z`});
      return id;
    }};
}

const run=(player_id,game,score,day,at=`${day}T01:00:00Z`)=>({player_id,game,score,day,updated_at:at});

test('A game podium keeps three places and only first place is a winner',()=>{
  const runs=[run('a','ridge',90,'2026-09-01'),run('b','ridge',80,'2026-09-02'),run('c','ridge',70,'2026-09-03'),run('d','ridge',60,'2026-09-04')];
  const podium=monthPodium(runs,'ridge');
  assert.deepEqual(podium.map(r=>[r.rank,r.player_id,r.winner]),[[1,'a',true],[2,'b',false],[3,'c',false]]);
  assert.equal(podium.filter(r=>r.winner).length,1,'one prize per game');
  assert.equal(podium.length,3,'fourth place is not archived');
});

test('Equal scores are split by whoever got there first, so a game still has one winner',()=>{
  const runs=[run('late','blocks',500,'2026-09-05','2026-09-05T09:00:00Z'),run('early','blocks',500,'2026-09-05','2026-09-05T08:00:00Z')];
  const podium=monthPodium(runs,'blocks');
  assert.deepEqual(podium.map(r=>[r.rank,r.player_id,r.winner]),[[1,'early',true],[2,'late',false]]);
});

test('A month archives three places a game and three winners in all',()=>{
  const runs=['blocks','sequence','ridge'].flatMap((game,g)=>['a','b','c','d'].map((p,i)=>run(p,game,100*(g+1)-i,'2026-09-07')));
  const rows=monthResults(runs,'2026-09');
  assert.equal(rows.length,9,'three places in each of three games');
  assert.ok(rows.every(r=>r.month==='2026-09'));
  assert.equal(rows.filter(r=>r.winner).length,3,'three winners a month');
  assert.deepEqual(rows.filter(r=>r.winner).map(r=>r.game),['blocks','sequence','ridge']);
  assert.ok(rows.filter(r=>r.winner).every(r=>r.rank===1));
  assert.ok(rows.filter(r=>r.rank>1).every(r=>r.winner===false),'second and third are never winners');
});

test('Months and prize text are cleaned, and the month before January is last December',()=>{
  assert.equal(previousMonth('2026-10'),'2026-09');
  assert.equal(previousMonth('2026-01'),'2025-12');
  assert.equal(cleanMonth('2026-09'),'2026-09');
  for(const bad of ['2026-13','2026-00','nope','',null])assert.equal(cleanMonth(bad),null);
  assert.equal(cleanPrize('  A free\n\nproduct  '),'A free product','prize text is one line');
  assert.equal(cleanPrize('x'.repeat(300)).length,120);
  assert.equal(monthLabel('2026-09'),'September 2026');
  assert.equal(gameLabel('blocks'),'Peak Blocks');
});

test('A board without prize text still says what first place wins',()=>{
  assert.equal(prizeLine({},'blocks'),PRIZE_FALLBACK);
  assert.equal(prizeLine({blocks:'   '},'blocks'),PRIZE_FALLBACK);
  assert.equal(prizeLine(null,'ridge'),PRIZE_FALLBACK);
  assert.equal(prizeLine({ridge:'A free bottle of your choice'},'ridge'),'A free bottle of your choice');
  assert.equal(PRIZE_FALLBACK,'1st place wins a prize');
});

test('The winner modal is only for first places, and one modal covers every game a player won',()=>{
  assert.equal(winnerModal([]),null,'no modal for a player who won nothing');
  assert.equal(winnerModal(null),null);
  const one=winnerModal([{game:'blocks',month:'2026-10'}]);
  assert.equal(one.title,'You won Peak Blocks for October!');
  assert.equal(one.note,"We'll contact you at your account email about your prize.");
  const two=winnerModal([{game:'blocks',month:'2026-10'},{game:'ridge',month:'2026-10'}]);
  assert.equal(two.title,'You won 2 games for October!');
  assert.deepEqual(two.games,['Peak Blocks','Ridge Run'],'one modal lists every game they won');
});

test('Copy winner emails copies first places only',()=>{
  const rows=[
    {rank:1,winner:true,email:'win1@x.com'},{rank:2,winner:false,email:'second@x.com'},{rank:3,winner:false,email:'third@x.com'},
    {rank:1,winner:true,email:'win2@x.com'},{rank:1,winner:true,email:'win3@x.com'},
  ];
  assert.equal(winnerEmails(rows),'win1@x.com, win2@x.com, win3@x.com');
  assert.equal(winnerEmails([{rank:1,winner:true,email:'both@x.com'},{rank:1,winner:true,email:'both@x.com'}]),'both@x.com','two wins is still one address');
  assert.equal(winnerEmails([]),'');
});

test('Only the competition admin can see or finalise monthly results',async()=>{
  const w=world(),player=await w.join('player@x.com','Player');
  for(const name of ['results','finalise'])assert.equal((await w.api[name]({token:null,body:{},query:{}})).status,401);
  assert.equal((await w.api.results({token:player.token,query:{}})).status,403);
  assert.equal((await w.api.finalise({token:player.token,body:{month:'2026-09'}})).status,403);
  const admin=await w.join(ADMIN,'Boss');
  assert.equal((await w.api.results({token:admin.token,query:{}})).status,200);
});

test('Results default to last month and cannot be finalised before the month ends',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss');
  const view=(await w.api.results({token:admin.token,query:{}})).body;
  assert.equal(view.month,'2026-09');
  assert.equal(view.thisMonth,'2026-10');
  assert.equal(view.finalised,false);
  assert.equal(view.source,'live','before finalising, the podium is worked out from the runs');
  assert.equal((await w.api.finalise({token:admin.token,body:{month:'2026-10'}})).status,400,'this month is still being played');
  assert.equal((await w.api.finalise({token:admin.token,body:{month:'nope'}})).status,400);
});

test('Finalising marks three winners and keeps second and third as backups',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss');
  const [ann,ben,cal,dee]=await Promise.all([w.join('ann@x.com','Ann'),w.join('ben@x.com','Ben'),w.join('cal@x.com','Cal'),w.join('dee@x.com','Dee')]);
  for(const game of ['blocks','sequence','ridge']){
    w.score(ann,game,400);w.score(ben,game,300);w.score(cal,game,200);w.score(dee,game,100);
  }
  const before=(await w.api.results({token:admin.token,query:{month:'2026-09'}})).body;
  assert.equal(before.finalised,false);
  assert.equal(before.winners.length,3,'the preview already shows who would win');

  const view=(await w.api.finalise({token:admin.token,body:{month:'2026-09'}})).body;
  assert.equal(view.finalised,true);
  assert.equal(view.source,'archive');
  assert.ok(view.finalisedAt);
  assert.equal(view.winners.length,3,'three winners a month, one per game');
  assert.ok(view.winners.every(r=>r.rank===1&&r.winner));
  assert.deepEqual(view.winners.map(r=>r.name),['Ann','Ann','Ann']);
  assert.deepEqual([...new Set(view.winners.map(r=>r.game))].sort(),['blocks','ridge','sequence']);
  assert.deepEqual(view.winners.map(r=>r.email),['ann@x.com','ann@x.com','ann@x.com'],'the admin can reach the winners');
  assert.equal(winnerEmails(view.winners),'ann@x.com','one player who topped all three games is one address');

  assert.equal(view.backups.length,6,'second and third of each game are kept for review');
  assert.ok(view.backups.every(r=>r.winner===false&&r.rank>1));
  assert.deepEqual([...new Set(view.backups.map(r=>r.name))].sort(),['Ben','Cal']);
  assert.ok(!view.backups.some(r=>r.name==='Dee'),'fourth place is not archived at all');
  assert.equal(winnerEmails(view.backups),'','a backup is not copied as a prize winner');

  for(const game of view.games)assert.deepEqual(game.podium.map(r=>r.rank),[1,2,3]);
  assert.deepEqual(view.finalisedMonths,['2026-09']);
  const stored=await w.store.monthResults('2026-09');
  assert.equal(stored.filter(r=>r.winner).length,3);
});

test('Only a first place is told they won, and one modal covers both games they topped',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss');
  const [ann,ben,cal]=await Promise.all([w.join('ann@x.com','Ann'),w.join('ben@x.com','Ben'),w.join('cal@x.com','Cal')]);
  w.score(ann,'blocks',400);w.score(ben,'blocks',300);w.score(cal,'blocks',200);
  w.score(ann,'ridge',90);w.score(ben,'ridge',80);w.score(cal,'ridge',70);
  w.score(ben,'sequence',900);w.score(ann,'sequence',800);w.score(cal,'sequence',700);

  for(const p of [ann,ben,cal])assert.deepEqual((await w.api.me({token:p.token})).body.wins,[],'nothing is announced before results are finalised');
  await w.api.finalise({token:admin.token,body:{month:'2026-09'}});

  const annMe=(await w.api.me({token:ann.token})).body;
  assert.deepEqual(annMe.wins,[{game:'blocks',month:'2026-09'},{game:'ridge',month:'2026-09'}]);
  const modal=winnerModal(annMe.wins);
  assert.equal(modal.title,'You won 2 games for September!','one modal, both games');
  assert.deepEqual(modal.games,['Peak Blocks','Ridge Run']);

  const benMe=(await w.api.me({token:ben.token})).body;
  assert.deepEqual(benMe.wins,[{game:'sequence',month:'2026-09'}],'second places are not wins');
  assert.equal(winnerModal(benMe.wins).title,'You won Sequence for September!');

  const calMe=(await w.api.me({token:cal.token})).body;
  assert.deepEqual(calMe.wins,[],'third place is told nothing');
  assert.equal(winnerModal(calMe.wins),null,'no modal for second or third');
  assert.equal(annMe.admin,false);
  assert.equal((await w.api.me({token:admin.token})).body.admin,true);
});

test('A board shows the prize line and last month\'s podium, with the winner marked',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss');
  const [ann,ben,cal]=await Promise.all([w.join('ann@x.com','Ann'),w.join('ben@x.com','Ben'),w.join('cal@x.com','Cal')]);
  w.score(ann,'blocks',400);w.score(ben,'blocks',300);w.score(cal,'blocks',200);

  let board=(await w.api.leaderboard({token:ben.token,query:{game:'blocks'}})).body;
  assert.equal(board.prize,PRIZE_FALLBACK,'a board always says what first place wins');
  assert.equal(board.lastMonth,null,'no podium until the month is finalised');

  await w.api.finalise({token:admin.token,body:{month:'2026-09',prizes:{blocks:'A free product of your choice'}}});
  board=(await w.api.leaderboard({token:ben.token,query:{game:'blocks'}})).body;
  assert.equal(board.prize,'A free product of your choice');
  assert.equal(board.prizes.sequence,PRIZE_FALLBACK,'the other games keep the default line');
  assert.equal(board.lastMonth.month,'2026-09');
  assert.equal(board.lastMonth.label,'September 2026');
  assert.deepEqual(board.lastMonth.podium.map(r=>[r.rank,r.name,r.winner]),[[1,'Ann',true],[2,'Ben',false],[3,'Cal',false]]);
  assert.equal(board.lastMonth.podium[1].you,true,'your own row is marked');
  assert.ok(board.lastMonth.podium.every(r=>typeof r.score==='number'));

  const ridge=(await w.api.leaderboard({token:ben.token,query:{game:'ridge'}})).body;
  assert.equal(ridge.lastMonth,null,'a game nobody played has no podium');
  const overall=(await w.api.leaderboard({token:ben.token,query:{}})).body;
  assert.equal(overall.prize,null,'the prize line belongs to a game board');
  assert.equal(overall.prizes.blocks,'A free product of your choice');
});

test('Prize text can be saved on its own, and bad input is refused',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss');
  const saved=await w.api.finalise({token:admin.token,body:{prizes:{ridge:'  A <b>free</b> bottle  '}}});
  assert.equal(saved.status,200);
  assert.equal(saved.body.month,'2026-09','saving prize text alone reports last month');
  assert.equal(saved.body.finalised,false,'and finalises nothing');
  assert.equal(saved.body.games.find(g=>g.game==='ridge').prize,'A b free /b bottle');
  assert.equal((await w.api.finalise({token:admin.token,body:{prizes:{tower:'x'}}})).status,400);
  assert.equal((await w.api.finalise({token:admin.token,body:{prizes:'free stuff'}})).status,400);
  assert.equal((await w.api.finalise({token:admin.token,body:{}})).status,400);
  assert.equal((await w.store.prizes()).ridge,'A b free /b bottle');
});

test('Finalising again after a disqualification promotes the backup and re-marks the winner',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss');
  const [ann,ben,cal]=await Promise.all([w.join('ann@x.com','Ann'),w.join('ben@x.com','Ben'),w.join('cal@x.com','Cal')]);
  const cheat=w.score(ann,'blocks',400);w.score(ben,'blocks',300);w.score(cal,'blocks',200);
  let view=(await w.api.finalise({token:admin.token,body:{month:'2026-09'}})).body;
  assert.deepEqual(view.winners.map(r=>r.name),['Ann']);
  assert.deepEqual((await w.api.me({token:ann.token})).body.wins,[{game:'blocks',month:'2026-09'}]);

  // Review throws out the winning run, exactly what the backups list is for.
  w.store.runs.get(cheat).status='rejected';
  view=(await w.api.finalise({token:admin.token,body:{month:'2026-09'}})).body;
  assert.deepEqual(view.winners.map(r=>[r.name,r.rank,r.winner]),[['Ben',1,true]]);
  assert.deepEqual(view.backups.map(r=>r.name),['Cal']);
  assert.deepEqual((await w.api.me({token:ben.token})).body.wins,[{game:'blocks',month:'2026-09'}]);
  assert.deepEqual((await w.api.me({token:ann.token})).body.wins,[],'a disqualified winner stops being one');
  assert.equal((await w.store.monthResults('2026-09')).filter(r=>r.winner).length,1);
});

test('Only finished months are archived, and the newest finalised month is the one on show',async()=>{
  const w=world('2026-11-05T01:00:00Z'),admin=await w.join(ADMIN,'Boss');
  const [ann,ben]=await Promise.all([w.join('ann@x.com','Ann'),w.join('ben@x.com','Ben')]);
  w.score(ann,'blocks',100,'2026-09-10');w.score(ben,'blocks',400,'2026-10-10');
  assert.equal(monthKey(w.now()),'2026-11');
  await w.api.finalise({token:admin.token,body:{month:'2026-09'}});
  assert.deepEqual((await w.api.me({token:ann.token})).body.wins,[{game:'blocks',month:'2026-09'}]);
  await w.api.finalise({token:admin.token,body:{month:'2026-10'}});
  assert.deepEqual((await w.api.me({token:ben.token})).body.wins,[{game:'blocks',month:'2026-10'}]);
  assert.deepEqual((await w.api.me({token:ann.token})).body.wins,[],'September is no longer the month on show');
  const board=(await w.api.leaderboard({token:ann.token,query:{game:'blocks'}})).body;
  assert.equal(board.lastMonth.month,'2026-10');
  assert.deepEqual((await w.api.results({token:admin.token,query:{}})).body.finalisedMonths,['2026-09','2026-10']);
});
