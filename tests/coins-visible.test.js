// Coins a player already holds must be visible and spendable whether or not anything is for sale.
// The shop needs somewhere to send money; a balance does not. These cover the five states the Play
// screen can be in - shop off with coins, shop off without, shop on, guest, signed out - on both sides:
// what the server reports in /api/me, and what the browser decides to draw from it.
import test from 'node:test';
import assert from 'node:assert/strict';
const {walletView,playOffer}=await import('../arcade/ui/wallet-view.js');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');
const {createManualProvider}=await import('../arcade/server/payments.mjs');

const SECRET='test-secret',ADMIN='boss@peak.test';
const PAY={accountName:'Peak Haven Pty Ltd',bsb:'083-004',accountNumber:'12345678',payId:'pay@peakhaven.test',
  instruction:'Put the reference in the description.',ready:true};
const NO_PAY={accountName:'',bsb:'',accountNumber:'',payId:'',instruction:'',ready:false};

function world({pay=PAY}={}){
  const store=createMemoryStore({invites:{CODE:50}}),auth=createMemoryAuth();
  const api=createHandlers({store,auth,secret:SECRET,admins:[ADMIN],payments:createManualProvider(pay)});
  const join=async(email,name)=>{
    const r=await api.join({body:{email,code:'CODE',name}});
    assert.equal(r.status,200,`join ${email}: ${r.body?.error}`);
    return {email,token:auth.tokenFor(email)};
  };
  const me=async who=>(await api.me({token:who.token})).body;
  return {api,store,join,me,
    async giveCoins(admin,who,delta){
      const players=(await api.admin({token:admin.token,query:{view:'coins'},method:'GET'})).body.players;
      const row=players.find(p=>p.email===who.email);
      const r=await api.admin({token:admin.token,body:{action:'adjust',player:row.id,delta,note:'granted by hand'}});
      assert.equal(r.status,200,`grant: ${r.body?.error}`);
    },
    async useFreeTries(who,game){
      for(let i=0;i<3;i++){const r=await api.start({token:who.token,body:{game}});assert.equal(r.status,200);}
    }};
}

// ---- the server half: what /api/me reports

test('Shop off, coins held: the balance is reported and a paid run still starts',async()=>{
  const w=world({pay:NO_PAY}),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.giveCoins(admin,ann,2);
  const me=await w.me(ann);
  assert.equal(me.shop.enabled,false,'nothing to sell');
  assert.equal(me.coinsReady,true,'but the coin tables exist');
  assert.equal(me.coins,2,'so the balance is reported, shop or no shop');
  await w.useFreeTries(ann,'blocks');
  const paid=await w.api.start({token:ann.token,body:{game:'blocks'}});
  assert.equal(paid.status,200);
  assert.equal(paid.body.paid,true,'a coin starts a run with no payment config');
  assert.equal((await w.me(ann)).coins,1);
});

test('Shop off, no coins: a nil balance is still reported, and nothing can be started or bought',async()=>{
  const w=world({pay:NO_PAY}),ann=await w.join('ann@x.com','Ann');
  const me=await w.me(ann);
  assert.equal(me.coinsReady,true);
  assert.equal(me.coins,0);
  assert.equal(me.shop.enabled,false);
  assert.deepEqual(me.shop.packs,[]);
  await w.useFreeTries(ann,'blocks');
  const out=await w.api.start({token:ann.token,body:{game:'blocks'}});
  assert.notEqual(out.status,200,'no free plays and no coins means no run');
});

test('Shop on: the balance is reported exactly the same way, alongside the packs',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.giveCoins(admin,ann,2);
  const me=await w.me(ann);
  assert.equal(me.coinsReady,true);
  assert.equal(me.coins,2,'the same number the shop-off deployment reports');
  assert.equal(me.shop.enabled,true);
  assert.ok(me.shop.packs.length>0);
});

// ---- the browser half: what gets drawn from that payload

test('Shop off with coins: a balance and no shop',()=>{
  const v=walletView({enabled:true,signedIn:true,coinsReady:true,coins:2,shopEnabled:false});
  assert.equal(v.showBalance,true,'an admin-granted coin has to be findable');
  assert.equal(v.coins,2);
  assert.equal(v.showShop,false,'with nowhere to send money there is nothing to sell');
  assert.equal(v.showSignIn,false);
});

test('Shop off with no coins: still a balance, so nil is an answer rather than a blank',()=>{
  const v=walletView({enabled:true,signedIn:true,coinsReady:true,coins:0,shopEnabled:false});
  assert.equal(v.showBalance,true);
  assert.equal(v.coins,0);
  assert.equal(v.showShop,false);
});

test('Shop on: balance and shop together',()=>{
  const v=walletView({enabled:true,signedIn:true,coinsReady:true,coins:5,shopEnabled:true});
  assert.equal(v.showBalance,true);
  assert.equal(v.showShop,true);
  assert.equal(v.showSignIn,false);
});

test('A guest sees no balance and is always offered a way to sign in',()=>{
  // withGuestMode reports enabled:false for a guest, and a guest has no server wallet at all.
  const v=walletView({enabled:false,signedIn:false,isGuest:true,coinsReady:false,coins:0});
  assert.equal(v.showBalance,false,'a guest has no account to hold coins');
  assert.equal(v.showShop,false);
  assert.equal(v.showSignIn,true,'the Play page hides the footer, so this is their only way back');
});

test('A signed-out player is offered a way in, and no wallet',()=>{
  const v=walletView({enabled:true,signedIn:false,coinsReady:true,coins:9});
  assert.equal(v.showSignIn,true);
  assert.equal(v.showBalance,false,'nobody is signed in, so there is no balance to show');
  assert.equal(v.coins,0,'and no number is carried over from a previous session');
  assert.equal(v.showShop,false);
});

test('Without the coin tables there is no wallet at all, whatever the shop says',()=>{
  const v=walletView({enabled:true,signedIn:true,coinsReady:false,coins:0,shopEnabled:false});
  assert.equal(v.showBalance,false);
  const odd=walletView({enabled:true,signedIn:true,coinsReady:false,coins:3,shopEnabled:true});
  assert.equal(odd.showBalance,false,'a stale number is not shown once the tables are gone');
  assert.equal(odd.coins,0);
});

test('A missing or nonsense payload never draws a broken wallet',()=>{
  assert.equal(walletView().showBalance,false);
  assert.equal(walletView({enabled:true,signedIn:true,coinsReady:true,coins:-4}).coins,0);
  assert.equal(walletView({enabled:true,signedIn:true,coinsReady:true,coins:'7'}).coins,7);
  assert.equal(walletView({enabled:true,signedIn:true,coinsReady:true,coins:2.9}).coins,2);
  assert.equal(walletView({enabled:true,signedIn:true,coinsReady:true,coins:NaN}).coins,0);
});

test('What the game offers: free plays first, then a coin, then come back tomorrow',()=>{
  assert.deepEqual(playOffer({freePlaysLeft:3,coins:0}),{canStart:true,paid:false,text:'3 plays left today'});
  assert.deepEqual(playOffer({freePlaysLeft:1,coins:5}),{canStart:true,paid:false,text:'1 play left today'},
    'free tries are spent before coins');
  assert.deepEqual(playOffer({freePlaysLeft:0,coins:1}),
    {canStart:true,paid:true,text:'No free plays left · uses 1 of your 1 coin'});
  assert.deepEqual(playOffer({freePlaysLeft:0,coins:4}),
    {canStart:true,paid:true,text:'No free plays left · uses 1 of your 4 coins'});
  assert.deepEqual(playOffer({freePlaysLeft:0,coins:0}),
    {canStart:false,paid:false,text:'No plays left today, back at midnight'});
  assert.equal(playOffer().canStart,false);
});
