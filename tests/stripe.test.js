// Card payments through Stripe Checkout, with Stripe itself mocked: a fetch that answers the way Stripe's API
// answers and records what was sent, and events signed with the same HMAC Stripe signs them with. No network,
// no database, no SDK.
//
// The one rule every test here is really about: **only a verified webhook grants a coin.** The request that
// starts a checkout grants nothing, the redirect the player comes back on grants nothing, an event with a bad
// signature grants nothing, and an event delivered twice grants once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const {COIN_PACKS,packFor}=await import('../arcade/server/coins.mjs');
const {createPaymentProvider,createStripeProvider}=await import('../arcade/server/payments.mjs');
const {createStripeWebhook,createStripeClient,cleanSiteUrl,encodeForm,readStripeEvent,stripeEnv,verifyStripeSignature}=await import('../arcade/server/stripe.mjs');
const {createHandlers}=await import('../arcade/server/handlers.mjs');
const {createMemoryStore,createMemoryAuth}=await import('../arcade/server/memory-store.mjs');
const {checkoutProgress,checkoutReturn}=await import('../arcade/ui/coins-return.js');

const SECRET='test-secret',ADMIN='boss@peak.test';
const WEBHOOK_SECRET='whsec_test_51HfakeSigningSecret';
// The environment as a Stripe deployment would set it. No real key is ever needed: the fetch is ours.
const KEYS={ARCADE_PAYMENT_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_51Fake',STRIPE_WEBHOOK_SECRET:WEBHOOK_SECRET,
  ARCADE_SITE_URL:'https://arcade.peakhaven.test/'};

// Stripe's API, as far as this integration uses it: create a Checkout Session, read one back. Every request is
// recorded so the tests can assert on what was actually sent, which is where "the browser cannot name its own
// price" is proved.
function fakeStripe(){
  const calls=[],sessions=new Map();
  let counter=0;
  const reply=(status,data)=>({ok:status<400,status,async text(){return JSON.stringify(data);}});
  async function fetchImpl(url,{method='GET',headers={},body=null}={}){
    const form=body?Object.fromEntries(new URLSearchParams(body)):null;
    calls.push({url,method,headers,form});
    if(method==='POST'&&url.endsWith('/checkout/sessions')){
      const id=`cs_test_${++counter}`;
      const session={id,object:'checkout.session',status:'open',payment_status:'unpaid',
        url:`https://checkout.stripe.test/c/pay/${id}`,
        amount_total:Number(form['line_items[0][price_data][unit_amount]']),
        currency:form['line_items[0][price_data][currency]'],
        payment_intent:`pi_test_${counter}`,
        client_reference_id:form.client_reference_id,
        success_url:form.success_url,cancel_url:form.cancel_url,
        metadata:{purchase_id:form['metadata[purchase_id]'],player_id:form['metadata[player_id]'],
          reference:form['metadata[reference]'],coins:form['metadata[coins]']}};
      sessions.set(id,session);
      return reply(200,session);
    }
    const one=/\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(url);
    if(method==='GET'&&one)
      return sessions.has(one[1])?reply(200,sessions.get(one[1])):reply(404,{error:{message:'No such checkout.session'}});
    return reply(400,{error:{message:`unexpected ${method} ${url}`}});
  }
  return {fetch:fetchImpl,calls,sessions,
    last(){return [...sessions.values()].at(-1);},
    // What Stripe does to the session when the card goes through, or when the player never came back.
    complete(id,{paid=true}={}){const s=sessions.get(id);s.status='complete';s.payment_status=paid?'paid':'unpaid';return {...s};},
    expire(id){const s=sessions.get(id);s.status='expired';return {...s};}};
}

// An event body and the Stripe-Signature header for it, signed exactly as Stripe signs one.
function sign(event,{secret=WEBHOOK_SECRET,timestamp,scheme='v1',digest=null}={}){
  const body=Buffer.from(JSON.stringify(event),'utf8');
  const signature=digest??createHmac('sha256',secret).update(`${timestamp}.`).update(body).digest('hex');
  return {body,signature:`t=${timestamp},${scheme}=${signature}`};
}
const sessionEvent=(session,{id='evt_completed',type='checkout.session.completed'}={})=>
  ({id,object:'event',type,data:{object:session}});
const chargeEvent=({paymentIntent,id='evt_refunded',type='charge.refunded',purchaseId=null,amount=999,refunded=999}={})=>
  ({id,object:'event',type,data:{object:{id:'ch_test_1',object:'charge',payment_intent:paymentIntent,
    amount,amount_refunded:refunded,metadata:purchaseId?{purchase_id:purchaseId}:{}}}});

// 2026-10-17 in Melbourne, so every run lands on the same day with the same three free tries, and signatures
// are timestamped off the same clock the webhook checks them against.
function world({sql=true,keys=KEYS,start='2026-10-17T01:00:00Z'}={}){
  let t=Date.parse(start);const now=()=>new Date(t);
  const stripe=fakeStripe();
  const store=createMemoryStore({invites:{TEAM:20},now,stripe:sql}),auth=createMemoryAuth();
  const payments=createStripeProvider(keys,{fetch:stripe.fetch});
  const api=createHandlers({store,auth,secret:SECRET,now,admins:[ADMIN],payments});
  // Nothing is logged in a test run; the handler's warnings are asserted on through its answers.
  const webhook=createStripeWebhook({store,env:stripeEnv(keys),providerId:payments.id,now,log:{error(){},warn(){}}});
  return {store,auth,api,payments,stripe,webhook,now,advance:seconds=>{t+=seconds*1000;},
    async join(email,name){
      const r=await api.join({body:{email,name,code:'TEAM'},origin:'https://arcade.peakhaven.test'});
      assert.equal(r.status,200,JSON.stringify(r.body));
      return {token:auth.tokenFor(email),id:[...auth.users.values()].find(u=>u.email===email).id,email,name};
    },
    async buy(player,coins){
      return api.buy({token:player.token,body:{coins},origin:'https://arcade.peakhaven.test/'});
    },
    async me(player){return (await api.me({token:player.token})).body;},
    // One event, signed off the world's own clock unless a test says otherwise.
    async send(event,options={}){
      const {body,signature}=sign(event,{timestamp:Math.floor(t/1000),...options});
      return webhook({body,signature});
    },
    async useFreeTries(player,game='blocks'){
      for(let i=0;i<3;i++){
        const r=await api.start({token:player.token,body:{game}});
        assert.equal(r.status,200,JSON.stringify(r.body));
        assert.equal(r.body.paid,false,'a free try is not a paid one');
      }
    }};
}

test('Buying a pack opens a Checkout Session for the price the server holds, and grants nothing',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  // The browser asks for the 10 pack and tries to name its own price. Both the amount it sent and the coin
  // count it did not are read from COIN_PACKS on the server.
  const r=await w.api.buy({token:ann.token,body:{coins:10,cents:1,amount:1,price:'A$0.01'},origin:'https://arcade.peakhaven.test/'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  const created=w.stripe.calls.find(c=>c.method==='POST');
  assert.equal(created.form['line_items[0][price_data][unit_amount]'],String(packFor(10).cents),'priced on the server');
  assert.equal(created.form['line_items[0][price_data][unit_amount]'],'1799');
  assert.equal(created.form['line_items[0][price_data][currency]'],'aud');
  assert.equal(created.form['line_items[0][quantity]'],'1');
  assert.equal(created.form.mode,'payment');
  assert.equal(created.form['metadata[player_id]'],ann.id,'the player is named on the session');
  assert.equal(created.form['metadata[coins]'],'10');
  assert.equal(created.form['payment_intent_data[metadata][purchase_id]'],created.form['metadata[purchase_id]'],
    'the payment carries the metadata too, because a refund arrives as a charge');
  assert.match(created.form.success_url,/^https:\/\/arcade\.peakhaven\.test\/\?coins=paid&ref=PHA-/);
  assert.match(created.form.cancel_url,/\?coins=cancelled&ref=PHA-/);
  assert.equal(created.headers['Idempotency-Key'],`purchase-${created.form['metadata[purchase_id]']}`,
    'a retried buy cannot leave two sessions behind');
  assert.match(created.headers.Authorization,/^Bearer sk_test_/);

  // What the browser is told: where to go, and nothing about a balance having changed.
  assert.equal(r.body.instructions.kind,'stripe');
  assert.equal(r.body.instructions.checkoutUrl,w.stripe.last().url);
  assert.equal(r.body.purchase.status,'pending');
  assert.equal(r.body.coins,0,'nothing is granted by asking to pay');
  assert.equal((await w.me(ann)).coins,0);
  assert.equal(w.store.ledger.length,0,'and nothing has moved in the ledger');
  // The session id is written down before the player leaves, so an event about it can be placed later.
  const purchase=[...w.store.purchases.values()][0];
  assert.equal(purchase.provider,'stripe');
  assert.equal(purchase.provider_ref,w.stripe.last().id);
});

test('A valid signed checkout.session.completed grants the coins, once',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,10);
  const session=w.stripe.complete(w.stripe.last().id);
  const first=await w.send(sessionEvent(session));
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.action,'grant');
  assert.equal(first.body.result.granted,true);
  assert.equal(first.body.result.balance,10);
  const wallet=await w.me(ann);
  assert.equal(wallet.coins,10,'the coins are there');
  assert.equal(wallet.purchases[0].status,'paid');
  // The payment behind the session is kept, which is what a later refund is traced through.
  const purchase=[...w.store.purchases.values()][0];
  assert.equal(purchase.provider_payment_ref,session.payment_intent);
  assert.equal(purchase.resolved_by,'stripe','the ledger says the webhook did it, not a person');
  assert.equal(w.store.ledger.filter(r=>r.reason==='purchase').length,1);

  // Stripe delivered the same event again: it is recognised and nothing happens twice.
  const again=await w.send(sessionEvent(session));
  assert.equal(again.status,200);
  assert.equal(again.body.repeat,true,'the event id was already written down');
  assert.equal((await w.me(ann)).coins,10,'the balance did not move');
  assert.equal(w.store.ledger.filter(r=>r.reason==='purchase').length,1,'and there is still one grant');

  // And a *different* event id about the same session still only grants once, because grant_purchase is the
  // real guarantee and the event log is only the fast path.
  const relabelled=await w.send(sessionEvent(session,{id:'evt_completed_again'}));
  assert.equal(relabelled.status,200);
  assert.equal(relabelled.body.result.granted,false,'the purchase was already granted');
  assert.equal((await w.me(ann)).coins,10);
  assert.equal(w.store.ledger.filter(r=>r.reason==='purchase').length,1);
});

test('A bad signature grants nothing',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  const session=w.stripe.complete(w.stripe.last().id);
  const event=sessionEvent(session);
  const cases=[
    ['signed with the wrong secret',{secret:'whsec_not_ours'}],
    ['a digest that is simply wrong',{digest:'0'.repeat(64)}],
    ['a digest that is not even hex of the right length',{digest:'nope'}],
    ['only the v0 test-mode scheme',{scheme:'v0'}],
  ];
  for(const [what,options] of cases){
    const r=await w.send(event,options);
    assert.equal(r.status,400,`${what}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error,/Signature check failed/);
    assert.equal((await w.me(ann)).coins,0,`${what}: no coins`);
  }
  // No header at all, and a header that is not a signature.
  for(const signature of [undefined,'','nonsense','t=,v1=','v1=abc']){
    const {body}=sign(event,{timestamp:Math.floor(w.now().getTime()/1000)});
    const r=await w.webhook({body,signature});
    assert.equal(r.status,400,JSON.stringify(r.body));
  }
  // A signature that was valid an hour ago. The timestamp is inside the signed payload, so a captured
  // delivery cannot be replayed later with it rewritten.
  const stale=await w.send(event,{timestamp:Math.floor(w.now().getTime()/1000)-3600});
  assert.equal(stale.status,400);
  assert.match(stale.body.error,/outside the 300 second window/);
  assert.equal((await w.me(ann)).coins,0);
  // And the body itself cannot be edited after signing: this is the attack the signature exists to stop.
  const {body,signature}=sign(event,{timestamp:Math.floor(w.now().getTime()/1000)});
  const tampered=Buffer.from(body.toString('utf8').replace('"amount_total":999','"amount_total":1'),'utf8');
  const edited=await w.webhook({body:tampered,signature});
  assert.equal(edited.status,400);
  assert.equal((await w.me(ann)).coins,0);
  assert.equal(w.store.paymentEvents.size,0,'nothing was written down either');
  // The raw body is what is signed, so a handler that was handed a parsed object refuses rather than guessing.
  const parsed=await w.webhook({body:null,signature});
  assert.equal(parsed.status,400);
  assert.match(parsed.body.error,/raw request body/);
});

test('The redirect the player comes back on grants nothing by itself',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  const bought=await w.buy(ann,10);
  const reference=bought.body.purchase.reference;
  // Stripe took the money and sent the player home. The webhook has not landed yet.
  w.stripe.complete(w.stripe.last().id);
  const back=checkoutReturn(`?coins=paid&ref=${reference}`);
  assert.deepEqual(back,{state:'paid',reference});
  let wallet=await w.me(ann);
  assert.equal(wallet.coins,0,'the address bar is not a receipt');
  // So the page waits, and says so, rather than claiming anything.
  const waiting=checkoutProgress({...back,purchases:wallet.purchases,coins:wallet.coins,attempts:0});
  assert.equal(waiting.phase,'waiting');
  assert.equal(waiting.poll,true);
  assert.equal(waiting.done,false);
  // Still nothing after the polling window: the player is told the coins are coming and not to pay again.
  const slow=checkoutProgress({...back,purchases:wallet.purchases,coins:wallet.coins,attempts:8});
  assert.equal(slow.phase,'slow');
  assert.equal(slow.poll,false);
  assert.match(slow.body,/do not pay again/);
  assert.match(slow.body,new RegExp(reference));
  // Then the webhook arrives, and only then is there anything to show.
  await w.send(sessionEvent(w.stripe.last()));
  wallet=await w.me(ann);
  const added=checkoutProgress({...back,purchases:wallet.purchases,coins:wallet.coins,attempts:1});
  assert.equal(added.phase,'added');
  assert.equal(added.added,10);
  assert.equal(added.coins,10);
  assert.equal(added.done,true);
  // A cancelled return says plainly that nothing was charged, and asks the server for nothing.
  const cancelled=checkoutProgress({...checkoutReturn('?coins=cancelled&ref=PHA-7K3Q'),purchases:[],coins:0});
  assert.equal(cancelled.phase,'cancelled');
  assert.match(cancelled.body,/Nothing has been charged/);
  // And an ordinary page load is not a return at all.
  for(const search of ['','?','#play','?coins=','?coins=whatever','?ref=PHA-7K3Q'])
    assert.equal(checkoutReturn(search),null,`${search} is not a checkout return`);
});

test('A refund takes back the unspent coins and drops the runs the spent ones paid for',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  const session=w.stripe.complete(w.stripe.last().id);
  await w.send(sessionEvent(session));
  assert.equal((await w.me(ann)).coins,5);
  // Three free tries, then two paid runs, so two of the five coins are spent.
  await w.useFreeTries(ann,'blocks');
  const paid=[];
  for(let i=0;i<2;i++){
    const r=await w.api.start({token:ann.token,body:{game:'blocks'}});
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.paid,true);
    paid.push(r.body.runId);
  }
  assert.equal((await w.me(ann)).coins,3);

  const refunded=await w.send(chargeEvent({paymentIntent:session.payment_intent,amount:999,refunded:999}));
  assert.equal(refunded.status,200,JSON.stringify(refunded.body));
  assert.equal(refunded.body.action,'refund');
  assert.equal(refunded.body.result.refunded,true);
  assert.equal(refunded.body.result.removed,3,'only the unspent coins can be taken back');
  assert.equal(refunded.body.result.runs,2,'and the runs the spent ones paid for stop counting');
  const wallet=await w.me(ann);
  assert.equal(wallet.coins,0);
  for(const id of paid){
    const run=await w.store.getRun(id);
    assert.equal(run.status,'rejected');
    assert.match(run.reject_reason,/^Refunded purchase PHA-/);
  }
  const purchase=[...w.store.purchases.values()][0];
  assert.equal(purchase.status,'refunded');
  assert.equal(purchase.resolved_by,'stripe');
  // Delivered twice, and a second refund of the same payment, both change nothing.
  assert.equal((await w.send(chargeEvent({paymentIntent:session.payment_intent}))).body.repeat,true);
  const twice=await w.send(chargeEvent({paymentIntent:session.payment_intent,id:'evt_refunded_2'}));
  assert.equal(twice.body.result.refunded,false,'there is nothing left to refund');
  assert.equal((await w.me(ann)).coins,0);
});

test('A dispute is handled the same way a refund is, and found through the payment',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  const session=w.stripe.complete(w.stripe.last().id);
  await w.send(sessionEvent(session));
  assert.equal((await w.me(ann)).coins,5);
  // A dispute names the payment, not the session, and carries no metadata of ours: it is placed through the
  // payment intent written down when the session completed.
  const dispute={id:'evt_disputed',object:'event',type:'charge.dispute.created',
    data:{object:{id:'dp_test_1',object:'dispute',charge:'ch_test_1',payment_intent:session.payment_intent,amount:999}}};
  const out=await w.send(dispute);
  assert.equal(out.status,200,JSON.stringify(out.body));
  assert.equal(out.body.action,'refund');
  assert.equal(out.body.result.refunded,true);
  assert.equal((await w.me(ann)).coins,0);
});

test('Nothing is granted for a payment that does not match the purchase',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann'),ben=await w.join('ben@x.com','Ben');
  await w.buy(ann,10);
  const open=w.stripe.last();
  // Paid in name only: a session that completed without the money is not a payment.
  const unpaid=await w.send(sessionEvent(w.stripe.complete(open.id,{paid:false})));
  assert.equal(unpaid.status,200);
  assert.match(unpaid.body.ignored,/not paid yet/);
  assert.equal((await w.me(ann)).coins,0);

  const session=w.stripe.complete(open.id);
  // The amount Stripe says it charged is checked against the purchase row, so a forged-but-signed event (a
  // leaked signing secret, a test-mode event aimed at live data) cannot buy 10 coins for a cent.
  const cheap=await w.send(sessionEvent({...session,amount_total:1},{id:'evt_cheap'}));
  assert.equal(cheap.status,200);
  assert.match(cheap.body.refused,/amount does not match/);
  assert.equal((await w.me(ann)).coins,0);
  const wrongCurrency=await w.send(sessionEvent({...session,currency:'usd'},{id:'evt_usd'}));
  assert.match(wrongCurrency.body.refused,/amount does not match/);
  assert.equal((await w.me(ann)).coins,0);
  // And a payment that names somebody else's player id is refused rather than credited to either of them.
  const wrongPlayer=await w.send(sessionEvent({...session,metadata:{...session.metadata,player_id:ben.id}},{id:'evt_other'}));
  assert.match(wrongPlayer.body.refused,/different player/);
  assert.equal((await w.me(ann)).coins,0);
  assert.equal((await w.me(ben)).coins,0);
  // An event about a purchase nobody here has.
  const unknown=await w.send(sessionEvent({...session,id:'cs_test_nothing',metadata:{},client_reference_id:null,
    payment_intent:'pi_test_nothing'},{id:'evt_unknown'}));
  assert.equal(unknown.status,200);
  assert.match(unknown.body.ignored,/no purchase of ours/);
  // Once the real event arrives, after all of that, it still grants exactly what was bought.
  const real=await w.send(sessionEvent(session,{id:'evt_real'}));
  assert.equal(real.body.result.granted,true);
  assert.equal((await w.me(ann)).coins,10);
});

test('A webhook never touches a bank-transfer purchase, and answers 503 when it is not switched on',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  const session=w.stripe.complete(w.stripe.last().id);
  // The same purchase, but being paid by bank transfer: only an admin may grant that one.
  const purchase=[...w.store.purchases.values()][0];
  purchase.provider='manual';
  const out=await w.send(sessionEvent(session));
  assert.equal(out.status,200);
  assert.match(out.body.ignored,/is not a Stripe purchase/);
  assert.equal((await w.me(ann)).coins,0);

  // A deployment on bank transfer: the endpoint exists but refuses to act, rather than granting from events
  // sent to a URL somebody found.
  const off=createStripeWebhook({store:w.store,env:stripeEnv(KEYS),providerId:'manual',now:w.now,log:{error(){},warn(){}}});
  const {body,signature}=sign(sessionEvent(session),{timestamp:Math.floor(w.now().getTime()/1000)});
  const refused=await off({body,signature});
  assert.equal(refused.status,503);
  // And a deployment with no signing secret cannot verify anything, so it refuses everything.
  const unconfigured=createStripeWebhook({store:w.store,env:stripeEnv({STRIPE_SECRET_KEY:'sk_test_x'}),now:w.now,log:{error(){},warn(){}}});
  assert.equal((await unconfigured({body,signature})).status,503);
});

test('An event type this endpoint does not act on is accepted and ignored',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  for(const type of ['payment_intent.succeeded','customer.created','invoice.paid','checkout.session.async_payment_failed']){
    const r=await w.send({id:`evt_${type.replace(/\W/g,'_')}`,object:'event',type,data:{object:{id:'obj_1'}}});
    assert.equal(r.status,200,`${type}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.received,true);
    assert.match(r.body.ignored,/is not one this endpoint acts on/);
  }
  assert.equal((await w.me(ann)).coins,0);
  assert.equal(w.store.paymentEvents.size,0,'an ignored event is not written down');
  // A body that is signed but is not an event at all, and one that is not even JSON. Both are refused rather
  // than reaching the database, and neither is written down.
  const at=Math.floor(w.now().getTime()/1000);
  assert.equal((await w.webhook(sign({nothing:true},{timestamp:at}))).status,200);
  const junk=Buffer.from('{not json','utf8');
  const signedJunk={body:junk,signature:`t=${at},v1=${createHmac('sha256',WEBHOOK_SECRET).update(`${at}.`).update(junk).digest('hex')}`};
  const out=await w.webhook(signedJunk);
  assert.equal(out.status,400);
  assert.match(out.body.error,/not an event/);
  assert.equal(w.store.paymentEvents.size,0);
});

test('A delayed payment grants when it clears, not when the page closed',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,5);
  const id=w.stripe.last().id;
  // Completed but unpaid, which is how a delayed method leaves a session.
  await w.send(sessionEvent(w.stripe.complete(id,{paid:false})));
  assert.equal((await w.me(ann)).coins,0);
  // The money clears later and Stripe says so with its own event type.
  const cleared=await w.send(sessionEvent(w.stripe.complete(id),{id:'evt_async',type:'checkout.session.async_payment_succeeded'}));
  assert.equal(cleared.body.result.granted,true);
  assert.equal((await w.me(ann)).coins,5);
});

test('An abandoned checkout is not a dead end',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  const first=await w.buy(ann,10);
  const session=w.stripe.last();
  // Tapping buy again with a payment still open hands back the same page rather than refusing: one payment at
  // a time must not cost the player the shop.
  const again=await w.buy(ann,25);
  assert.equal(again.status,200,JSON.stringify(again.body));
  assert.equal(again.body.purchase.reference,first.body.purchase.reference);
  assert.equal(again.body.instructions.checkoutUrl,session.url);
  assert.equal(w.store.purchases.size,1,'and no second purchase is left lying around');

  // Paid, with the webhook moments away: starting another would be wrong, and the message says why.
  w.stripe.complete(session.id);
  const confirming=await w.buy(ann,25);
  assert.equal(confirming.status,409);
  assert.match(confirming.body.error,/being confirmed/);
  assert.equal(w.store.purchases.size,1);

  // Expired after a day: that attempt is dead, so it is closed and the new one takes its place.
  w.stripe.expire(session.id);
  const fresh=await w.buy(ann,25);
  assert.equal(fresh.status,200,JSON.stringify(fresh.body));
  assert.notEqual(fresh.body.purchase.reference,first.body.purchase.reference);
  assert.equal(fresh.body.purchase.coins,25);
  assert.equal(w.store.purchases.size,2);
  assert.equal([...w.store.purchases.values()][0].status,'cancelled');
  assert.equal((await w.me(ann)).coins,0,'none of which granted a coin');

  // And Stripe's own expiry event closes one too, so a player who never comes back is not left blocked.
  const second=[...w.store.purchases.values()][1];
  const expired=await w.send(sessionEvent(w.stripe.expire(second.provider_ref),
    {id:'evt_expired',type:'checkout.session.expired'}));
  assert.equal(expired.status,200,JSON.stringify(expired.body));
  assert.equal(expired.body.action,'expire');
  assert.equal(expired.body.result.cancelled,true);
  assert.equal([...w.store.purchases.values()][1].status,'cancelled');
});

test('Without the migration the card shop is hidden and the webhook asks for it',async()=>{
  const w=world({sql:false}),ann=await w.join('ann@x.com','Ann');
  const wallet=await w.me(ann);
  assert.equal(wallet.coinsReady,true,'paid-tries is there, so the wallet is');
  assert.equal(wallet.shop.enabled,false,'but nothing is for sale until stripe.sql has run');
  assert.equal(wallet.shop.packs.length,0);
  const buy=await w.buy(ann,10);
  assert.equal(buy.status,503);
  assert.equal(w.stripe.calls.length,0,'and Stripe was never called');
  // The admin page says which file to run.
  const admin=await w.join(ADMIN,'Boss');
  const view=(await w.api.admin({token:admin.token,query:{view:'coins'},method:'GET'})).body;
  assert.equal(view.provider,'stripe');
  assert.equal(view.paymentReady,true);
  assert.equal(view.providerReady,false);
  // An event arriving before the file has been run is answered 503, which is Stripe's cue to retry it.
  const {body,signature}=sign(sessionEvent({id:'cs_test_x',payment_status:'paid',amount_total:1799,currency:'aud',
    metadata:{purchase_id:'nope'}}),{timestamp:Math.floor(w.now().getTime()/1000)});
  const out=await w.webhook({body,signature});
  assert.equal(out.status,503);
  assert.match(out.body.error,/stripe\.sql/);
});

test('The shop stays hidden until Stripe is configured, and the provider switch decides which shop',async()=>{
  // Keys set: the card shop, with the packs and the note about where the player is going.
  const stripeShop=world();
  const ann=await stripeShop.join('ann@x.com','Ann');
  const wallet=await stripeShop.me(ann);
  assert.equal(wallet.shop.enabled,true);
  assert.equal(wallet.shop.provider,'stripe');
  assert.deepEqual(wallet.shop.packs.map(p=>p.coins),COIN_PACKS.map(p=>p.coins));
  assert.equal(wallet.shop.payment.kind,'stripe');
  assert.match(wallet.shop.payment.note,/secure checkout/);
  assert.equal(wallet.shop.payment.lines.length,0,'there are no bank details to show');

  // No keys: the provider is Stripe but it is not ready, so there is no shop at all.
  const bare=world({keys:{ARCADE_PAYMENT_PROVIDER:'stripe'}});
  const bob=await bare.join('bob@x.com','Bob');
  const bareWallet=await bare.me(bob);
  assert.equal(bareWallet.shop.enabled,false);
  assert.equal(bareWallet.coinsReady,true,'and the wallet still shows a balance of nil');
  assert.equal((await bare.buy(bob,10)).status,503);
  // Unset altogether is the manual provider with no details, which is also no shop.
  assert.equal(createPaymentProvider({}).id,'manual');
  assert.equal(createPaymentProvider({}).ready,false);
});

test('Where Stripe is sent back to, and what it is told to call this purchase',async()=>{
  // ARCADE_SITE_URL wins; without it the origin the request arrived on is used; nothing else is accepted.
  assert.equal(cleanSiteUrl('https://arcade.peakhaven.test'),'https://arcade.peakhaven.test/');
  assert.equal(cleanSiteUrl('https://arcade.peakhaven.test/play/'),'https://arcade.peakhaven.test/play/');
  assert.equal(cleanSiteUrl('http://localhost:8775/'),'http://localhost:8775/');
  for(const bad of ['','not a url','http://example.com/','javascript:alert(1)',null])
    assert.equal(cleanSiteUrl(bad),null,`${bad} is not somewhere to send a player`);
  // With no site url and no origin there is nowhere to come back to, and that is an error rather than a guess.
  const noHome=createStripeProvider({STRIPE_SECRET_KEY:'sk_test_x',STRIPE_WEBHOOK_SECRET:'whsec_x'},{fetch:async()=>{throw new Error('should not be called');}});
  await assert.rejects(()=>noHome.begin({id:'p1',reference:'PHA-7K3Q',coins:1,amount_cents:299,currency:'AUD',player_id:'pl1'},{origin:null}),
    /ARCADE_SITE_URL/);
  // The origin of the request is enough on its own.
  const w=world({keys:{ARCADE_PAYMENT_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_x',STRIPE_WEBHOOK_SECRET:'whsec_x'}});
  const ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,1);
  assert.match(w.stripe.calls[0].form.success_url,/^https:\/\/arcade\.peakhaven\.test\/\?coins=paid/);
});

test('The parts the rest of it is built from',async()=>{
  // The form encoder, which is how every nested parameter reaches Stripe.
  assert.deepEqual(encodeForm({mode:'payment',metadata:{purchase_id:'p1'},line_items:[{quantity:1,price_data:{unit_amount:299}}]}),
    [['mode','payment'],['metadata[purchase_id]','p1'],['line_items[0][quantity]','1'],['line_items[0][price_data][unit_amount]','299']]);
  assert.deepEqual(encodeForm({skip:null,keep:0}),[['keep','0']],'a null is left out, a zero is not');

  // The signature check, on its own.
  const body=Buffer.from('{"id":"evt_1"}','utf8');
  const at=1792000000,now=()=>new Date(at*1000);
  const digest=t=>createHmac('sha256','whsec_x').update(`${t}.`).update(body).digest('hex');
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at},v1=${digest(at)}`,secret:'whsec_x',now}).ok,true);
  // Two signatures in one header, as there are for a day after an endpoint secret is rolled: either matching
  // is enough.
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at},v1=${'0'.repeat(64)},v1=${digest(at)}`,secret:'whsec_x',now}).ok,true);
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at},v0=${digest(at)},v1=${'0'.repeat(64)}`,secret:'whsec_x',now}).ok,false);
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at},v1=${digest(at)}`,secret:'whsec_other',now}).ok,false);
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at-301},v1=${digest(at-301)}`,secret:'whsec_x',now}).ok,false,'too old');
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at+301},v1=${digest(at+301)}`,secret:'whsec_x',now}).ok,false,'and too far ahead');
  assert.equal(verifyStripeSignature({payload:body,header:`t=${at},v1=${digest(at)}`,secret:'',now}).ok,false,'no secret, no trust');
  // The same payload as a string rather than bytes still verifies, because it is the same bytes.
  assert.equal(verifyStripeSignature({payload:'{"id":"evt_1"}',header:`t=${at},v1=${digest(at)}`,secret:'whsec_x',now}).ok,true);

  // Reading an event, with nothing else involved.
  const grant=readStripeEvent({id:'evt_1',type:'checkout.session.completed',
    data:{object:{id:'cs_1',payment_status:'paid',amount_total:1799,currency:'aud',payment_intent:'pi_1',
      metadata:{purchase_id:'p1',player_id:'pl1'}}}});
  assert.equal(grant.action,'grant');
  assert.equal(grant.paid,true);
  assert.equal(grant.currency,'AUD','compared in one case, so aud and AUD are the same currency');
  assert.equal(grant.amountCents,1799);
  assert.equal(grant.purchaseId,'p1');
  assert.equal(grant.sessionId,'cs_1');
  assert.equal(grant.paymentRef,'pi_1');
  // client_reference_id is the fallback when metadata has been stripped.
  assert.equal(readStripeEvent({id:'evt_2',type:'checkout.session.completed',
    data:{object:{id:'cs_2',client_reference_id:'p2'}}}).purchaseId,'p2');
  assert.equal(readStripeEvent({id:'evt_3',type:'charge.refunded',data:{object:{payment_intent:'pi_3'}}}).action,'refund');
  assert.equal(readStripeEvent({id:'evt_4',type:'charge.dispute.created',data:{object:{payment_intent:'pi_4'}}}).action,'refund');
  assert.equal(readStripeEvent({id:'evt_5',type:'checkout.session.expired',data:{object:{id:'cs_5'}}}).action,'expire');
  assert.equal(readStripeEvent({type:'checkout.session.completed',data:{object:{}}}).action,'ignore','no id, nothing to record');
  assert.equal(readStripeEvent({id:'evt_6',type:'payment_intent.succeeded',data:{object:{}}}).action,'ignore');
  // An id with anything in it that is not a Stripe id is not read as one.
  assert.equal(readStripeEvent({id:'evt_7',type:'checkout.session.completed',
    data:{object:{id:'cs_1; drop table purchases',payment_intent:'pi_1'}}}).sessionId,null);

  // And the client refuses what Stripe refuses, with the message Stripe gave.
  const client=createStripeClient({secretKey:'sk_test_x',
    fetch:async()=>({ok:false,status:402,async text(){return JSON.stringify({error:{message:'Your card was declined.',code:'card_declined'}});}})});
  await assert.rejects(()=>client.getCheckoutSession('cs_1'),/Your card was declined/);
  await assert.rejects(()=>client.getCheckoutSession('not-an-id'),/not a Checkout Session id/);
  const offline=createStripeClient({secretKey:'sk_test_x',fetch:async()=>{throw new Error('getaddrinfo ENOTFOUND');}});
  await assert.rejects(()=>offline.getCheckoutSession('cs_1'),/could not be reached/);
});

test('A checkout Stripe will not open leaves nothing behind',async()=>{
  const w=world();
  // Stripe is down, or the key is wrong: the purchase row that was made for it is closed again, so the player
  // can try once more instead of being told they already have a payment waiting.
  w.payments.begin=async()=>{const {StripeError}=await import('../arcade/server/stripe.mjs');throw new StripeError('Invalid API Key provided');};
  const ann=await w.join('ann@x.com','Ann');
  const out=await w.buy(ann,10);
  assert.equal(out.status,502);
  assert.match(out.body.error,/Nothing has been charged/);
  assert.equal([...w.store.purchases.values()][0].status,'cancelled');
  assert.equal((await w.me(ann)).purchases.length,0,'nothing is left waiting for payment');
});

test('The admin page shows a card purchase with its Stripe session and status',async()=>{
  const w=world(),admin=await w.join(ADMIN,'Boss'),ann=await w.join('ann@x.com','Ann');
  await w.buy(ann,10);
  const session=w.stripe.last();
  const view=async()=>(await w.api.admin({token:admin.token,query:{view:'coins'},method:'GET'})).body;
  const pendingView=await view();
  assert.equal(pendingView.provider,'stripe');
  assert.equal(pendingView.paymentReady,true);
  assert.equal(pendingView.providerReady,true);
  assert.equal(pendingView.needsAdminConfirmation,false,'nobody marks a card payment paid');
  assert.equal(pendingView.pending.length,1);
  assert.equal(pendingView.pending[0].provider,'stripe');
  assert.equal(pendingView.pending[0].providerRef,session.id,'the Checkout Session id is on the page');
  assert.equal(pendingView.pending[0].email,'ann@x.com');

  await w.send(sessionEvent(w.stripe.complete(session.id)));
  const paidView=await view();
  assert.equal(paidView.pending.length,0);
  assert.equal(paidView.settled[0].status,'paid');
  assert.equal(paidView.settled[0].providerRef,session.id);
  assert.equal(paidView.settled[0].providerPaymentRef,session.payment_intent);
  assert.equal(paidView.settled[0].resolvedBy,'stripe');
  assert.equal(paidView.ledger[0].admin_email,'stripe','the ledger says the webhook granted it');

  // An admin can still refund one by hand, which goes down the same path the webhook uses.
  const refund=await w.api.admin({token:admin.token,body:{action:'refund',id:paidView.settled[0].id}});
  assert.equal(refund.status,200,JSON.stringify(refund.body));
  assert.equal(refund.body.result.refunded,true);
  assert.equal((await w.me(ann)).coins,0);
  // And "Mark paid" on a card purchase is not offered, but is harmless if it is ever sent: the purchase is
  // already paid, so nothing is granted twice.
  const marked=await w.api.admin({token:admin.token,body:{action:'paid',id:paidView.settled[0].id}});
  assert.equal(marked.body.result.granted,false);
  assert.equal((await w.me(ann)).coins,0);
});

test('Only a signed-in player can buy, and only an admin can see the money',async()=>{
  const w=world(),ann=await w.join('ann@x.com','Ann');
  assert.equal((await w.api.buy({token:null,body:{coins:10}})).status,401);
  assert.equal((await w.api.buy({token:'token-nobody',body:{coins:10}})).status,401);
  assert.equal((await w.api.buy({token:ann.token,body:{coins:7}})).status,400,'7 is not a pack');
  assert.equal((await w.api.buy({token:ann.token,body:{}})).status,400);
  assert.equal(w.stripe.calls.length,0,'none of which reached Stripe');
  assert.equal((await w.api.admin({token:ann.token,query:{view:'coins'},method:'GET'})).status,403);
});
