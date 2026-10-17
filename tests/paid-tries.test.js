// Paid extra tries: one coin buys one extra run of a ranked game once that game's three free tries for the day
// are gone. Free tries are always spent first, prices live on the server, coins only appear when an admin marks
// a bank transfer paid, and a paid run is an ordinary run on the leaderboard. Uses the in-memory store and auth,
// so no network and no database are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks,createPlanner} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial}=await import('../dist/tryout-games.js');
const {SIM_STEP}=await import('../dist/rng.js');
const {COIN_PACKS,CoinsNotReady,MAX_PENDING_PURCHASES,REFERENCE_ALPHABET,REFERENCE_PATTERN,cleanDelta,cleanNote,cleanPackCoins,cleanReference,coinsMissing,formatAmount,newReference,packFor,packList,paymentDetails,refundPlan}=await import('../arcade/server/coins.mjs');
const {createManualProvider,createPaymentProvider,createStripeProvider}=await import('../arcade/server/payments.mjs');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');

const SECRET='test-secret',ADMIN='boss@peak.test';
// Bank details as a deployment would set them (ARCADE_PAY_*), so the shop is open.
const PAY={accountName:'Peak Haven Pty Ltd',bsb:'083-004',accountNumber:'12345678',payId:'pay@peakhaven.test',
  instruction:'Put the reference in the description.',ready:true};
const NO_PAY={accountName:'',bsb:'',accountNumber:'',payId:'',instruction:'',ready:false};

// A deployment that has not run arcade/supabase/paid-tries.sql: no tables, no column, no functions. The reads
// fall back the way supabase-store.mjs makes them fall back, and anything that would move a coin says so.
function withoutCoins(store){
  return {...store,
    async coinsReady(){return false;},
    async coinsFor(){return 0;},
    async allPlayers(){return (await store.allPlayers()).map(p=>({...p,coins:0}));},
    async playerPurchases(){return [];},
    async purchasesByStatus(){return [];},
    async coinLedger(){return [];},
    async createPurchase(){throw new CoinsNotReady();},
    async grantPurchase(){throw new CoinsNotReady();},
    async cancelPurchase(){throw new CoinsNotReady();},
    async adjustCoins(){throw new CoinsNotReady();},
    async refundPurchase(){throw new CoinsNotReady();},
    startRun({allowPaid,...rest}){return store.startRun({...rest,allowPaid:false});},
  };
}

// 2026-10-17 in Melbourne, so every run in a test lands on the same day and the same three free tries.
function world({coins=true,pay=PAY,start='2026-10-17T01:00:00Z'}={}){
  let t=Date.parse(start);const now=()=>new Date(t);
  const base=createMemoryStore({invites:{TEAM:20},now}),auth=createMemoryAuth();
  const store=coins?base:withoutCoins(base);
  const payments=createManualProvider(pay);
  const api=createHandlers({store,auth,secret:SECRET,now,admins:[ADMIN],payments});
  const w={store:base,wrapped:store,auth,api,payments,now,advance:s=>{t+=s*1000;},
    async join(email,name){
      const r=await api.join({body:{email,name,code:'TEAM'},origin:'https://example.test'});
      assert.equal(r.status,200,JSON.stringify(r.body));
      return {token:auth.tokenFor(email),id:[...auth.users.values()].find(u=>u.email===email).id,email,name};
    },
    // Spends today's three free tries of one game, without playing them out.
    async useFreeTries(player,game='blocks'){
      for(let i=0;i<3;i++){
        const r=await api.start({token:player.token,body:{game}});
        assert.equal(r.status,200,JSON.stringify(r.body));
        assert.equal(r.body.paid,false,'a free try is not a paid one');
      }
      return (await api.me({token:player.token})).body.plays[game];
    },
    // Coins the quick way, as an admin handing them out, for the tests that are not about buying.
    async giveCoins(admin,player,delta,note='test top-up'){
      const r=await api.coins({token:admin.token,body:{player:player.id,delta,note}});
      assert.equal(r.status,200,JSON.stringify(r.body));
      return r.body.result.balance;
    },
    async buy(player,coins){return api.buy({token:player.token,body:{coins}});},
    async resolve(admin,id,action){return api.purchase({token:admin.token,body:{id,action}});},
    // A verified score written straight onto a run, for the board checks that are not about replaying.
    scoreRun(runId,score){
      const run=base.runs.get(runId);
      Object.assign(run,{score,status:'closed',segments:1,level:1,updated_at:now().toISOString(),finished_at:now().toISOString()});
      return run;
    }};
  return w;
}

// One real Ridge run, played by the test bot and submitted the way the browser submits it.
async function playRidge(api,player,runId,seed){
  const out=stubCallbacks(),engine=new RidgeEngine(stubCanvas(),out.cb,{seed,motion:false}),bot=createPlanner(RIDGE,hitsVial);
  engine.action();
  while(!engine.dead&&!engine.ended&&engine.gatesPassed<4){
    if(bot.decide(engine))engine.action();
    for(let i=0;i<bot.every&&!engine.dead;i++)engine.step(SIM_STEP);
  }
  engine.finish();engine.destroy();
  return {played:out.result,
    finish:()=>api.finish({token:player.token,body:{runId,replay:out.result.replay,claimed:out.result.score}}),
    ticks:engine.ticks};
}

test('Packs and prices come from the server, and a browser cannot name either',async()=>{
  assert.deepEqual(COIN_PACKS.map(p=>[p.coins,p.cents]),[[1,299],[5,999],[10,1799],[25,2999]],'1 for A$2.99, 5 for A$9.99, 10 for A$17.99, 25 for A$29.99');
  assert.deepEqual(packList().map(p=>p.price),['A$2.99','A$9.99','A$17.99','A$29.99']);
  assert.equal(packList().filter(p=>p.popular).length,1);
  assert.equal(packList().find(p=>p.popular).coins,10,'the 10 pack is the popular one');
  assert.equal(formatAmount(1799),'A$17.99');
  assert.equal(cleanPackCoins(10),10);
  for(const bad of [0,3,7,-5,26,1.5,'ten',null,undefined,NaN,Infinity])assert.equal(cleanPackCoins(bad),null,String(bad));
  assert.equal(packFor(7),null);

  const w=world(),ann=await w.join('ann@x.com','Ann');
  assert.equal((await w.buy(ann,7)).status,400,'an unknown pack is not a pack');
  // Everything a browser could try to send about money is ignored: only the coin count is read.
  const r=await w.api.buy({token:ann.token,body:{coins:10,cents:1,amount:1,amount_cents:1,price:'A$0.01',currency:'XXX',coinsGranted:9999,status:'paid'}});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.purchase.amount,1799);
  assert.equal(r.body.purchase.price,'A$17.99');
  assert.equal(r.body.purchase.coins,10);
  assert.equal(r.body.purchase.currency,'AUD');
  assert.equal(r.body.purchase.status,'pending','buying grants nothing on its own');
  assert.equal(r.body.coins,0,'and no coins have been handed over');
  assert.equal([...w.store.purchases.values()][0].amount_cents,1799,'the stored amount is the server price');
});

test('A purchase reference is unique, easy to type, and retried if it ever clashes',async()=>{
  assert.match(newReference(),REFERENCE_PATTERN);
  for(const ambiguous of ['0','O','1','I','L','2','Z','5','S','8','B','6','G'])
    assert.equal(REFERENCE_ALPHABET.includes(ambiguous),false,`no ${ambiguous} in a reference`);
  const seen=new Set();
  for(let i=0;i<4000;i++){const ref=newReference();assert.match(ref,REFERENCE_PATTERN);seen.add(ref);}
  assert.ok(seen.size>3500,`references are random, got ${seen.size} of 4000`);
  assert.equal(cleanReference('pha7k3q'),'PHA-7K3Q','typed back in any case and without the dash');
  assert.equal(cleanReference(' pha 7k3q '),'PHA-7K3Q');
  assert.equal(cleanReference('PHA-7K3Q'),'PHA-7K3Q');
  assert.equal(cleanReference('PHA-0O1I'),null,'a reference can only hold the unambiguous letters');
  assert.equal(cleanReference('nonsense'),null);

  const w=world(),ann=await w.join('ann@x.com','Ann'),ben=await w.join('ben@x.com','Ben');
  const one=await w.buy(ann,5),two=await w.buy(ben,5);
  assert.equal(one.status,200);assert.equal(two.status,200);
  assert.notEqual(one.body.purchase.reference,two.body.purchase.reference);
  // The database has the last word on uniqueness.
  await assert.rejects(()=>w.store.createPurchase({playerId:ann.id,pack:1,coins:1,amountCents:299,currency:'AUD',
    reference:one.body.purchase.reference,provider:'manual'}),/duplicate key/);
  // So the handler asks for another reference and carries on.
  const cat=await w.join('cat@x.com','Cat');
  const real=w.wrapped.createPurchase.bind(w.wrapped);let clashes=0;
  w.wrapped.createPurchase=async args=>{
    if(clashes++<1)throw Object.assign(new Error('duplicate key value violates unique constraint "purchases_reference_key"'),{code:'23505'});
    return real(args);
  };
  const third=await w.buy(cat,1);
  w.wrapped.createPurchase=real;
  assert.equal(third.status,200,JSON.stringify(third.body));
  assert.equal(clashes,2,'it tried again rather than failing');
  assert.match(third.body.purchase.reference,REFERENCE_PATTERN);
});

test('A player sees the amount, the reference and where to send it, and only one request at a time',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  const r=await w.buy(ann,5);
  assert.equal(r.status,200);
  assert.equal(r.body.instructions.kind,'manual');
  assert.equal(r.body.instructions.amount,'A$9.99');
  assert.equal(r.body.instructions.reference,r.body.purchase.reference);
  assert.deepEqual(r.body.instructions.lines.map(l=>l.label),['Account name','BSB','Account number','PayID']);
  assert.equal(r.body.instructions.lines[0].value,PAY.accountName);
  assert.equal(r.body.instructions.note,PAY.instruction);
  // Waiting for payment, and shown as such until it is resolved.
  const me=(await w.api.me({token:ann.token})).body;
  assert.equal(me.coins,0);
  assert.deepEqual(me.purchases.map(p=>[p.reference,p.status]),[[r.body.purchase.reference,'pending']]);
  assert.equal(me.shop.enabled,true);
  assert.equal(me.shop.provider,'manual');
  assert.deepEqual(me.shop.packs.map(p=>p.coins),[1,5,10,25]);
  assert.equal(MAX_PENDING_PURCHASES,1);
  const again=await w.buy(ann,10);
  assert.equal(again.status,409,'a second reference nobody can match to a bank line is worse than none');
  assert.equal(again.body.purchase.reference,r.body.purchase.reference);
  // Cancelled, and they can ask again.
  const pending=(await w.api.purchases({token:(await w.join(ADMIN,'Boss')).token})).body.pending;
  assert.equal(pending.length,1);
  assert.equal(pending[0].name,'Ann');
  assert.equal(pending[0].email,'ann@x.com');
  assert.equal(pending[0].coins,5);
  assert.equal(pending[0].price,'A$9.99');
  assert.equal(typeof pending[0].ageMinutes,'number');
  const admin={token:w.auth.tokenFor(ADMIN)};
  assert.equal((await w.resolve(admin,pending[0].id,'cancel')).status,200);
  assert.equal((await w.buy(ann,10)).status,200,'after a cancellation they can ask again');
  assert.equal((await w.api.me({token:ann.token})).body.coins,0,'and a cancellation grants nothing');
});

test('Marking a purchase paid grants the coins exactly once',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  const bought=await w.buy(ann,10);
  const id=(await w.api.purchases({token:admin.token})).body.pending[0].id;
  const first=await w.resolve(admin,id,'paid');
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.result.granted,true);
  assert.equal(first.body.result.balance,10);
  assert.deepEqual(first.body.pending,[],'it is no longer waiting');
  // Clicking again, double-tapping, or two admins at once: still ten coins.
  const second=await w.resolve(admin,id,'paid');
  assert.equal(second.status,200);
  assert.equal(second.body.result.granted,false,'the second click grants nothing');
  assert.equal(second.body.result.balance,10);
  const both=await Promise.all([w.resolve(admin,id,'paid'),w.resolve(admin,id,'paid')]);
  assert.deepEqual(both.map(r=>r.body.result.granted),[false,false]);
  assert.equal((await w.api.me({token:ann.token})).body.coins,10);
  const grants=w.store.ledger.filter(r=>r.reason==='purchase');
  assert.equal(grants.length,1,'one grant row per purchase, whatever happens');
  assert.equal(grants[0].admin_email,ADMIN,'and it records who did it');
  assert.equal(grants[0].delta,10);
  // The player is told, so the page can say "+10 coins added" once.
  const me=(await w.api.me({token:ann.token})).body;
  assert.deepEqual(me.purchases.map(p=>[p.reference,p.status]),[[bought.body.purchase.reference,'paid']]);
  assert.equal(me.purchases[0].coins,10);
  // Cancelling something already paid changes nothing.
  const late=await w.resolve(admin,id,'cancel');
  assert.equal(late.body.result.cancelled,false);
  assert.equal((await w.api.me({token:ann.token})).body.coins,10);
});

test('Free tries are spent first, then one coin per extra run',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  assert.equal(await w.giveCoins(admin,ann,5,'bought offline'),5);
  // The three free tries are free.
  for(let i=0;i<3;i++){
    const r=await w.api.start({token:ann.token,body:{game:'blocks'}});
    assert.equal(r.status,200);
    assert.equal(r.body.paid,false);
    assert.equal(r.body.coins,5,'a free try costs nothing');
  }
  const me=(await w.api.me({token:ann.token})).body;
  assert.deepEqual(me.plays,{blocks:0,sequence:3,ridge:3},'only that game ran out');
  assert.equal(me.coins,5);
  // The fourth is paid.
  const paid=await w.api.start({token:ann.token,body:{game:'blocks'}});
  assert.equal(paid.status,200);
  assert.equal(paid.body.paid,true);
  assert.equal(paid.body.coins,4,'one coin, one extra run');
  assert.equal(paid.body.plays.blocks,0,'and a paid run does not use up a free try');
  assert.equal(w.store.runs.get(paid.body.runId).paid,true);
  const spent=w.store.ledger.filter(r=>r.reason==='run');
  assert.equal(spent.length,1);
  assert.deepEqual([spent[0].delta,spent[0].run_id],[-1,paid.body.runId]);
  // The other games still have their free tries, and they are still free.
  const other=await w.api.start({token:ann.token,body:{game:'ridge'}});
  assert.equal(other.body.paid,false);
  assert.equal(other.body.coins,4);
  // No daily cap: the rest of the coins buy the rest of the runs.
  for(let i=0;i<4;i++)assert.equal((await w.api.start({token:ann.token,body:{game:'blocks'}})).body.paid,true);
  assert.equal((await w.api.me({token:ann.token})).body.coins,0);
  const empty=await w.api.start({token:ann.token,body:{game:'blocks'}});
  assert.equal(empty.status,409);
  assert.equal(empty.body.coins,0);
  assert.match(empty.body.error,/No free plays left/);
});

test('One coin and two taps at once gives exactly one run',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.giveCoins(admin,ann,1,'one coin only');
  await w.useFreeTries(ann,'ridge');
  const [a,b]=await Promise.all([
    w.api.start({token:ann.token,body:{game:'ridge'}}),
    w.api.start({token:ann.token,body:{game:'ridge'}}),
  ]);
  const made=[a,b].filter(r=>r.status===200),refused=[a,b].filter(r=>r.status===409);
  assert.equal(made.length,1,'one coin cannot make two runs');
  assert.equal(refused.length,1);
  assert.equal(made[0].body.paid,true);
  assert.equal((await w.api.me({token:ann.token})).body.coins,0);
  assert.equal([...w.store.runs.values()].filter(r=>r.paid).length,1);
  assert.equal(w.store.ledger.filter(r=>r.reason==='run').length,1);
});

test('A paid run is verified and scored exactly like a free one',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.giveCoins(admin,ann,2,'for the comparison');
  // The free try and the paid try get the same course on the same day, so the same play must score the same.
  const free=await w.api.start({token:ann.token,body:{game:'ridge'}});
  const freeRun=await playRidge(w.api,ann,free.body.runId,free.body.seed);
  w.advance(freeRun.ticks*SIM_STEP+2);
  const freeFinish=await freeRun.finish();
  assert.equal(freeFinish.status,200,JSON.stringify(freeFinish.body));
  assert.equal(freeFinish.body.score,freeRun.played.score);
  assert.equal(freeFinish.body.coins,2,'finishing a free run costs nothing');

  await w.api.start({token:ann.token,body:{game:'ridge'}});
  await w.api.start({token:ann.token,body:{game:'ridge'}});
  const paid=await w.api.start({token:ann.token,body:{game:'ridge'}});
  assert.equal(paid.body.paid,true);
  assert.equal(paid.body.seed,free.body.seed,'same day, same course');
  const paidRun=await playRidge(w.api,ann,paid.body.runId,paid.body.seed);
  w.advance(paidRun.ticks*SIM_STEP+2);
  const paidFinish=await paidRun.finish();
  assert.equal(paidFinish.status,200,JSON.stringify(paidFinish.body));
  assert.equal(paidFinish.body.score,freeFinish.body.score,'a paid run scores the same as a free one');
  assert.equal(paidFinish.body.done,true);
  assert.equal(paidFinish.body.board.rank,1);
  assert.equal(paidFinish.body.coins,1,'and it cost the one coin it was started with');
  // On the board it is an ordinary run: nothing says it was paid for.
  const board=(await w.api.leaderboard({token:ann.token,query:{game:'ridge'}})).body;
  assert.equal(board.top.length,1);
  assert.equal(board.top[0].points,freeFinish.body.score);
  assert.equal(JSON.stringify(board).includes('coin'),false,'no coin anywhere on a leaderboard');
  assert.equal(JSON.stringify(board).includes('paid'),false);
});

test('A refund takes back only unspent coins and drops the runs the spent ones paid for',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  const id=(await w.api.purchases({token:admin.token})).body.pending[0].id;
  const reference=(await w.api.purchases({token:admin.token})).body.pending[0].reference;
  await w.resolve(admin,id,'paid');
  await w.useFreeTries(ann,'blocks');
  // Two of the five coins are spent on runs that go on the board; three are never spent.
  const firstPaid=await w.api.start({token:ann.token,body:{game:'blocks'}});
  w.scoreRun(firstPaid.body.runId,900);
  const secondPaid=await w.api.start({token:ann.token,body:{game:'blocks'}});
  w.scoreRun(secondPaid.body.runId,1200);
  // A free run of another game, which a refund must not touch.
  const freeRun=await w.api.start({token:ann.token,body:{game:'ridge'}});
  w.scoreRun(freeRun.body.runId,400);
  assert.equal((await w.api.me({token:ann.token})).body.coins,3);
  const before=(await w.api.leaderboard({token:ann.token,query:{game:'blocks'}})).body;
  assert.equal(before.top[0].points,1200,'a paid run counts while it is paid for');

  const refund=await w.resolve(admin,id,'refund');
  assert.equal(refund.status,200,JSON.stringify(refund.body));
  assert.deepEqual([refund.body.result.refunded,refund.body.result.unspent,refund.body.result.removed,refund.body.result.runs],
    [true,3,3,2],'three unspent coins back, two paid runs dropped');
  assert.equal(refund.body.result.balance,0);
  assert.equal((await w.api.me({token:ann.token})).body.coins,0,'and the balance is not negative');
  // The two paid runs no longer count anywhere; the free run is untouched.
  const after=(await w.api.leaderboard({token:ann.token,query:{game:'blocks'}})).body;
  assert.deepEqual(after.top,[],'the refunded runs are off the board');
  const ridge=(await w.api.leaderboard({token:ann.token,query:{game:'ridge'}})).body;
  assert.equal(ridge.top[0].points,400,'a free run is none of a refund\'s business');
  for(const runId of [firstPaid.body.runId,secondPaid.body.runId]){
    const run=w.store.runs.get(runId);
    assert.equal(run.status,'rejected');
    assert.equal(run.reject_reason,`Refunded purchase ${reference}`,'the run says why it stopped counting');
  }
  assert.equal(w.store.runs.get(freeRun.body.runId).status,'closed');
  // Logged, with who did it, and not repeatable.
  const logged=w.store.ledger.at(-1);
  assert.equal(logged.reason,'refund');
  assert.equal(logged.delta,-3);
  assert.equal(logged.admin_email,ADMIN);
  assert.match(logged.note,/2 paid run\(s\) dropped/);
  const twice=await w.resolve(admin,id,'refund');
  assert.equal(twice.body.result.refunded,false,'a refunded purchase cannot be refunded again');
  assert.equal((await w.api.me({token:ann.token})).body.coins,0);
});

test('A purchase only pays for the runs its own coins started',()=>{
  // Coins are spent oldest first, so a purchase in the middle of a ledger owns a window of the spends.
  const purchase={id:'p2',coins:5};
  const ledger=[
    {id:'1',created_at:'2026-10-01T00:00:00Z',delta:2,reason:'admin',purchase_id:null,run_id:null},
    {id:'2',created_at:'2026-10-02T00:00:00Z',delta:5,reason:'purchase',purchase_id:'p2',run_id:null},
    {id:'3',created_at:'2026-10-03T00:00:00Z',delta:-1,reason:'run',purchase_id:null,run_id:'r1'},
    {id:'4',created_at:'2026-10-04T00:00:00Z',delta:-1,reason:'run',purchase_id:null,run_id:'r2'},
    {id:'5',created_at:'2026-10-05T00:00:00Z',delta:-1,reason:'run',purchase_id:null,run_id:'r3'},
    {id:'6',created_at:'2026-10-06T00:00:00Z',delta:-1,reason:'run',purchase_id:null,run_id:'r4'},
  ];
  const plan=refundPlan(ledger,purchase);
  assert.deepEqual(plan.runs,['r3','r4'],'the first two spends were the earlier admin coins');
  assert.equal(plan.unspent,3);
  assert.equal(plan.spent,2);
  // Coins an admin took back are gone but started no run, so there is nothing to drop for them.
  const taken=refundPlan([...ledger,{id:'7',created_at:'2026-10-07T00:00:00Z',delta:-2,reason:'admin',purchase_id:null,run_id:null}],purchase);
  assert.deepEqual(taken.runs,['r3','r4']);
  assert.equal(taken.unspent,1);
  assert.equal(taken.spent,4);
  // Nothing was ever granted for an unknown purchase, so nothing can be refunded.
  assert.deepEqual(refundPlan(ledger,{id:'nope',coins:5}),{unspent:0,spent:0,runs:[]});
  assert.deepEqual(refundPlan([],{id:'p2',coins:5}),{unspent:0,spent:0,runs:[]});
});

test('A balance can never go below zero',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.giveCoins(admin,ann,5,'five to start');
  const over=await w.api.coins({token:admin.token,body:{player:ann.id,delta:-100,note:'chargeback'}});
  assert.equal(over.status,200,JSON.stringify(over.body));
  assert.equal(over.body.result.balance,0,'taking more than they have empties it');
  assert.equal(over.body.result.delta,-5,'and the ledger records what was actually taken');
  assert.equal(w.store.ledger.at(-1).delta,-5);
  assert.equal(w.store.ledger.at(-1).note,'chargeback');
  assert.equal(w.store.ledger.at(-1).admin_email,ADMIN);
  const again=await w.api.coins({token:admin.token,body:{player:ann.id,delta:-3,note:'and again'}});
  assert.equal(again.body.result.balance,0);
  assert.equal(again.body.result.delta,0);
  assert.match(w.store.ledger.at(-1).note,/no change/);
  assert.equal(w.store.players.get(ann.id).coins,0);
  // A note is the point of a by-hand adjustment, and zero is not an adjustment.
  assert.equal((await w.api.coins({token:admin.token,body:{player:ann.id,delta:3}})).status,400);
  assert.equal((await w.api.coins({token:admin.token,body:{player:ann.id,delta:3,note:'  '}})).status,400);
  assert.equal((await w.api.coins({token:admin.token,body:{player:ann.id,delta:0,note:'nothing'}})).status,400);
  assert.equal((await w.api.coins({token:admin.token,body:{player:ann.id,delta:1.5,note:'half'}})).status,400);
  assert.equal((await w.api.coins({token:admin.token,body:{player:'not-a-player',delta:1,note:'who'}})).status,404);
  assert.equal(cleanDelta(0),null);assert.equal(cleanDelta(501),null);assert.equal(cleanDelta(-4),-4);
  assert.equal(cleanNote('  ok  '),null,'a note has to actually say something');
  assert.equal(cleanNote('  yes  '),'yes');
  assert.equal(cleanNote('refund for PHA-7K3Q'),'refund for PHA-7K3Q');
  // And with no coins and no free tries, a run simply does not start.
  await w.useFreeTries(ann,'blocks');
  const refused=await w.api.start({token:ann.token,body:{game:'blocks'}});
  assert.equal(refused.status,409);
  assert.equal(w.store.players.get(ann.id).coins,0);
});

test('Only an admin can see or move money',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  const bought=await w.buy(ann,1);
  const id=(await w.api.purchases({token:admin.token})).body.pending[0].id;
  for(const call of [
    ()=>w.api.purchases({token:ann.token}),
    ()=>w.api.purchase({token:ann.token,body:{id,action:'paid'}}),
    ()=>w.api.purchase({token:ann.token,body:{id,action:'refund'}}),
    ()=>w.api.coins({token:ann.token,body:{player:ann.id,delta:100,note:'free coins please'}}),
  ]){
    const r=await call();
    assert.equal(r.status,403,JSON.stringify(r.body));
  }
  for(const call of [
    ()=>w.api.purchases({token:null}),
    ()=>w.api.purchase({token:null,body:{id,action:'paid'}}),
    ()=>w.api.coins({token:null,body:{player:ann.id,delta:100,note:'hello'}}),
    ()=>w.api.buy({token:null,body:{coins:1}}),
  ]){
    const r=await call();
    assert.equal(r.status,401,JSON.stringify(r.body));
  }
  assert.equal((await w.api.me({token:ann.token})).body.coins,0,'none of that granted anything');
  assert.equal(bought.body.purchase.status,'pending');
  assert.equal((await w.api.purchase({token:admin.token,body:{id,action:'nonsense'}})).status,400);
  assert.equal((await w.api.purchase({token:admin.token,body:{action:'paid'}})).status,400);
  assert.equal((await w.api.purchase({token:admin.token,body:{id:'00000000-0000-4000-8000-000000000000',action:'paid'}})).status,404);
});

test('The shop stays hidden until there is somewhere for the money to go',async()=>{
  const w=world({pay:NO_PAY}),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  const me=(await w.api.me({token:ann.token})).body;
  assert.equal(me.shop.enabled,false,'no bank details, no shop');
  assert.deepEqual(me.shop.packs,[]);
  assert.equal(me.shop.payment,null);
  assert.equal((await w.buy(ann,5)).status,503,'and nothing can be bought');
  // Coins already handed out still work, so a player is never left holding something they cannot spend.
  await w.giveCoins(admin,ann,1,'granted before the details were set');
  await w.useFreeTries(ann,'blocks');
  const paid=await w.api.start({token:ann.token,body:{game:'blocks'}});
  assert.equal(paid.status,200);
  assert.equal(paid.body.paid,true);
  assert.equal(paid.body.coins,0);
  // What makes a set of details enough to pay.
  assert.equal(paymentDetails({}).ready,false);
  assert.equal(paymentDetails({ARCADE_PAY_ACCOUNT_NAME:'Peak Haven'}).ready,false,'a name alone is not payable');
  assert.equal(paymentDetails({ARCADE_PAY_ACCOUNT_NAME:'Peak Haven',ARCADE_PAY_BSB:'083-004'}).ready,false);
  assert.equal(paymentDetails({ARCADE_PAY_ACCOUNT_NAME:'Peak Haven',ARCADE_PAY_BSB:'083-004',ARCADE_PAY_ACCOUNT_NUMBER:'1234'}).ready,true);
  assert.equal(paymentDetails({ARCADE_PAY_ACCOUNT_NAME:'Peak Haven',ARCADE_PAY_PAYID:'pay@peak.test'}).ready,true);
  assert.equal(paymentDetails({ARCADE_PAY_ACCOUNT_NAME:' Peak  Haven <b> '}).accountName,'Peak Haven b');
});

test('The payment step is pluggable, and Stripe is a stub and not a dependency',async()=>{
  assert.equal(createPaymentProvider({}).id,'manual','manual unless told otherwise');
  assert.equal(createPaymentProvider({}).ready,false,'and not ready until the details are set');
  assert.equal(createPaymentProvider({ARCADE_PAYMENT_PROVIDER:'manual',ARCADE_PAY_ACCOUNT_NAME:'Peak Haven',ARCADE_PAY_PAYID:'pay@peak.test'}).ready,true);
  const manual=createManualProvider(PAY);
  assert.equal(manual.needsAdminConfirmation,true,'a bank transfer needs a person to confirm it');
  const begun=await manual.begin({reference:'PHA-7K3Q',amount_cents:999});
  assert.equal(begun.status,'pending');
  assert.equal(begun.instructions.amount,'A$9.99');
  const stripe=createStripeProvider();
  assert.equal(stripe.id,'stripe');
  assert.equal(stripe.ready,false,'nothing is implemented yet');
  assert.equal(stripe.needsAdminConfirmation,false);
  await assert.rejects(()=>stripe.begin({}),/not implemented yet/);
  assert.equal(createPaymentProvider({ARCADE_PAYMENT_PROVIDER:'stripe'}).ready,false,'so the shop stays hidden');
  assert.equal(createPaymentProvider({ARCADE_PAYMENT_PROVIDER:'bitcoin'}).ready,false,'and an unknown provider hides it too');
  // The package is deliberately not installed yet.
  const packageJson=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(Boolean(packageJson.dependencies?.stripe),false,'no stripe dependency until it is actually built');
});

test('Without the migration everything else keeps working and the shop is hidden',async()=>{
  const w=world({coins:false}),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  assert.equal(coinsMissing({code:'42P01',message:'relation "public.purchases" does not exist'}),true);
  assert.equal(coinsMissing({code:'42703',message:'column players.coins does not exist'}),true);
  assert.equal(coinsMissing({code:'PGRST202',message:'Could not find the function public.start_run'}),true);
  assert.equal(coinsMissing({code:'23505',message:'duplicate key value violates unique constraint'}),false,'a real error still has to surface');
  assert.equal(coinsMissing(null),false);
  assert.match(new CoinsNotReady().message,/paid-tries\.sql/,'the message says which file to run');

  // The wallet reads as empty and the shop is not there.
  const me=(await w.api.me({token:ann.token})).body;
  assert.equal(me.coins,0);
  assert.deepEqual(me.purchases,[]);
  assert.equal(me.shop.enabled,false);
  assert.deepEqual(me.plays,{blocks:3,sequence:3,ridge:3});
  assert.equal(me.player.name,'Ann');
  // The boards and the games are untouched.
  const board=(await w.api.leaderboard({token:ann.token,query:{game:'blocks'}})).body;
  assert.equal(board.players,0);
  const started=await w.api.start({token:ann.token,body:{game:'ridge'}});
  assert.equal(started.status,200);
  assert.equal(started.body.paid,false);
  assert.equal(started.body.coins,0);
  const run=await playRidge(w.api,ann,started.body.runId,started.body.seed);
  w.advance(run.ticks*SIM_STEP+2);
  const finished=await run.finish();
  assert.equal(finished.status,200,JSON.stringify(finished.body));
  assert.equal(finished.body.score,run.played.score);
  assert.equal(finished.body.coins,0);
  // The three free tries are all there is, and nothing tries to spend a coin.
  await w.api.start({token:ann.token,body:{game:'ridge'}});
  await w.api.start({token:ann.token,body:{game:'ridge'}});
  const refused=await w.api.start({token:ann.token,body:{game:'ridge'}});
  assert.equal(refused.status,409);
  assert.equal(refused.body.coins,0);
  assert.equal(refused.body.shop,false);
  // Buying says so politely, and the admin page knows to ask for the migration.
  assert.equal((await w.buy(ann,5)).status,503);
  const view=await w.api.purchases({token:admin.token});
  assert.equal(view.status,200);
  assert.equal(view.body.ready,false,'the page knows the tables are missing');
  assert.deepEqual(view.body.pending,[]);
  assert.deepEqual(view.body.players,[]);
  for(const r of [
    await w.api.purchase({token:admin.token,body:{id:'00000000-0000-4000-8000-000000000000',action:'paid'}}),
    await w.api.coins({token:admin.token,body:{player:ann.id,delta:5,note:'top up'}}),
  ]){
    assert.equal(r.status,503);
    assert.match(r.body.error,/paid-tries\.sql/);
  }
});
