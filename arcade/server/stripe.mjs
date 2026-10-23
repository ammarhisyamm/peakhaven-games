// Stripe Checkout, as the arcade's second way of paying for a coin pack. The player is sent to Stripe's own
// hosted page, so nothing here ever sees a card number, and nothing a browser sends is believed about money:
// the pack is chosen by its coin count, the price is read from server/coins.mjs, and the amount on the
// Checkout Session is compared against the purchase row again before a single coin is granted.
//
// Three things live in this file:
//
//   a thin client over Stripe's REST API — two calls, so there is no SDK and no new dependency, and the tests
//   run on node alone with a fetch of their own;
//
//   signature verification, done by hand the way Stripe documents it: Stripe-Signature carries `t=` and one
//   or more `v1=`, the signed payload is `<t>.<raw body>`, the digest is HMAC-SHA256 keyed with the endpoint's
//   signing secret, and the comparison is constant time against every v1 (rolling an endpoint secret leaves
//   two live for up to a day and Stripe signs once per secret). A `v0` is a test-mode decoy and is ignored;
//
//   the webhook, which is the only thing in the arcade that grants coins for a card payment. The success
//   redirect grants nothing at all, so a player who closes the tab, or types the success URL by hand, changes
//   nothing. Granting is public.grant_purchase, which already lets one grant exist per purchase however many
//   times it is called, and every event Stripe delivers is written down by its own id, so a replayed event
//   does nothing twice.
import {createHmac, timingSafeEqual} from 'node:crypto';
import {COIN_CURRENCY} from './coins.mjs';

export const STRIPE_API='https://api.stripe.com/v1';
// Stripe's own libraries allow five minutes between the signed timestamp and now, which is what makes a
// captured payload useless an hour later.
export const SIGNATURE_TOLERANCE_SECONDS=300;
// Every event type the endpoint is asked to send. Anything else is answered 200 and ignored, so adding one in
// the dashboard by mistake cannot break the endpoint.
export const STRIPE_EVENTS=Object.freeze(['checkout.session.completed','checkout.session.async_payment_succeeded',
  'checkout.session.expired','charge.refunded','charge.dispute.created']);

// A Stripe object id, as it arrives in an event or a redirect. Letters, numbers and underscores only, which is
// what Stripe uses, and what makes it safe to put in a URL or a filter.
const STRIPE_ID=/^[A-Za-z0-9_]{1,255}$/;
export const cleanStripeId=value=>{const id=String(value??'').trim();return STRIPE_ID.test(id)?id:null;};

export class StripeError extends Error{
  constructor(message,{status=0,code=null}={}){super(message);this.name='StripeError';this.status=status;this.code=code;}
}
// The migration that holds the Stripe columns and the event log (supabase/stripe.sql), as CoinsNotReady is for
// paid-tries.sql: until it has run the shop stays hidden and the webhook says so instead of granting blind.
export class StripeNotReady extends Error{
  constructor(){super('Card payments are not set up yet. Run arcade/supabase/stripe.sql in Supabase, then try again.');this.name='StripeNotReady';}
}

// The keys and the signing secret, from the environment and never from the repo. `ready` is false until both
// are there, which keeps the shop hidden on a half-configured deployment rather than offering a checkout that
// cannot be paid or a payment that cannot be verified.
export function stripeEnv(env=process.env){
  const pick=name=>String(env[name]??'').trim();
  const secretKey=pick('STRIPE_SECRET_KEY'),webhookSecret=pick('STRIPE_WEBHOOK_SECRET');
  return {secretKey,webhookSecret,
    // Unset means Stripe uses the account's own default API version, which is what the dashboard shows.
    apiVersion:pick('STRIPE_API_VERSION')||null,
    siteUrl:cleanSiteUrl(pick('ARCADE_SITE_URL')),
    ready:Boolean(secretKey&&webhookSecret),
    live:secretKey.startsWith('sk_live_')};
}
// Where the player is sent back to. A deployment only needs this when the host the request arrived on is not
// the one the arcade is served from; otherwise the request's own origin is used.
export function cleanSiteUrl(value){
  const raw=String(value??'').trim();
  if(!raw)return null;
  let url;try{url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:'&&url.hostname!=='localhost'&&url.hostname!=='127.0.0.1')return null;
  return `${url.origin}${url.pathname.replace(/\/+$/,'')}/`;
}
// The arcade address a Checkout Session sends the player back to. The reference travels in the query rather
// than the fragment because ui/account.js rewrites the fragment when a sign-in link is followed.
export function returnUrl(base,params){
  const url=new URL(cleanSiteUrl(base)??'https://localhost/');
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  return url.toString();
}

// Stripe's API takes form-encoded bodies with bracketed keys: metadata[purchase_id], line_items[0][quantity].
export function encodeForm(value,prefix=''){
  if(value===null||value===undefined)return [];
  if(Array.isArray(value))return value.flatMap((item,index)=>encodeForm(item,`${prefix}[${index}]`));
  if(typeof value==='object')return Object.entries(value).flatMap(([key,item])=>encodeForm(item,prefix?`${prefix}[${key}]`:key));
  return [[prefix,String(value)]];
}
const formBody=form=>new URLSearchParams(encodeForm(form)).toString();

// Two calls, both over fetch: create a Checkout Session, and read one back. `fetch` is injectable so the tests
// can answer with Stripe's own shapes and assert on what was sent, with no network anywhere.
export function createStripeClient({secretKey,apiVersion=null,fetch:fetchImpl=globalThis.fetch}={}){
  if(!secretKey)throw new StripeError('Stripe is not configured: STRIPE_SECRET_KEY is not set.');
  async function call(path,{method='GET',form=null,idempotencyKey=null}={}){
    const headers={Authorization:`Bearer ${secretKey}`};
    if(apiVersion)headers['Stripe-Version']=apiVersion;
    if(form)headers['Content-Type']='application/x-www-form-urlencoded';
    // Stripe replays the first answer for a repeated key, so a retried buy cannot leave two sessions behind.
    if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    let response;
    try{response=await fetchImpl(`${STRIPE_API}${path}`,{method,headers,body:form?formBody(form):undefined});}
    catch(error){throw new StripeError(`Stripe could not be reached: ${error.message}`);}
    const text=await response.text().catch(()=>'');
    let data=null;try{data=text?JSON.parse(text):null;}catch{}
    if(!response.ok)throw new StripeError(data?.error?.message||`Stripe answered ${response.status}.`,
      {status:response.status,code:data?.error?.code??null});
    if(!data)throw new StripeError('Stripe answered with nothing.',{status:response.status});
    return data;
  }
  return {
    // One line item, priced here in whole cents. The pack's coin count, the purchase and the player travel in
    // the metadata — on the session and on the payment intent, because a refund arrives as a charge and that
    // is where a charge can be traced back from.
    async createCheckoutSession({purchase,coins,cents,currency=COIN_CURRENCY,playerId,successUrl,cancelUrl,description=null}){
      const label=`${coins} extra ${coins===1?'try':'tries'} · Peak Haven Arcade`;
      const metadata={purchase_id:purchase.id,player_id:playerId,reference:purchase.reference,coins:String(coins)};
      return call('/checkout/sessions',{method:'POST',idempotencyKey:`purchase-${purchase.id}`,form:{
        mode:'payment',
        success_url:successUrl,
        cancel_url:cancelUrl,
        client_reference_id:purchase.id,
        metadata,
        payment_intent_data:{metadata,description:description??label},
        line_items:[{quantity:1,price_data:{currency:String(currency).toLowerCase(),unit_amount:cents,
          product_data:{name:label,description:'One coin starts one extra run of any ranked game.'}}}],
      }});
    },
    async getCheckoutSession(id){
      const session=cleanStripeId(id);
      if(!session)throw new StripeError('That is not a Checkout Session id.');
      return call(`/checkout/sessions/${session}`);
    },
  };
}

// Whether this payload really came from Stripe. Takes the raw bytes: anything that has been parsed and
// re-serialised is no longer what was signed, and must not be verified against.
export function verifyStripeSignature({payload,header,secret,now=()=>new Date(),toleranceSeconds=SIGNATURE_TOLERANCE_SECONDS}){
  if(!secret)return {ok:false,error:'This deployment has no Stripe webhook signing secret.'};
  const body=Buffer.isBuffer(payload)?payload:Buffer.from(String(payload??''),'utf8');
  if(!body.length)return {ok:false,error:'The request had no body, so there was nothing to verify.'};
  const parts=String(header??'').split(',').map(part=>part.split('='));
  const timestamp=parts.find(([key])=>String(key).trim()==='t')?.[1]?.trim()??'';
  // Only v1. A v0 signature is a test-mode decoy and anything else is a scheme this does not understand;
  // trusting either would be the downgrade Stripe warns about.
  const signatures=parts.filter(([key])=>String(key).trim()==='v1').map(([,value])=>String(value??'').trim()).filter(Boolean);
  if(!/^\d{1,12}$/.test(timestamp)||!signatures.length)return {ok:false,error:'The Stripe-Signature header is not a signature.'};
  const expected=createHmac('sha256',secret).update(`${timestamp}.`).update(body).digest();
  const matched=signatures.some(signature=>{
    // A malformed hex string decodes short, and a short buffer cannot be compared in constant time, so the
    // length is checked first and a mismatch simply fails.
    const given=Buffer.from(signature,'hex');
    return given.length===expected.length&&timingSafeEqual(given,expected);
  });
  if(!matched)return {ok:false,error:'No signature in the header matches this payload.'};
  const age=Math.floor(now().getTime()/1000)-Number(timestamp);
  if(toleranceSeconds>0&&Math.abs(age)>toleranceSeconds)
    return {ok:false,error:`The signature is ${age} seconds old, which is outside the ${toleranceSeconds} second window.`};
  return {ok:true,timestamp:Number(timestamp)};
}

// What one event means to the arcade, as plain data: which purchase it is about, what should happen to it, and
// the numbers to check before anything does. Nothing here reads the database or the network, so every branch
// is covered by a test.
export function readStripeEvent(event){
  const type=String(event?.type??''),eventId=cleanStripeId(event?.id);
  const object=event?.data?.object??{};
  const ignore=reason=>({action:'ignore',type,eventId,reason});
  if(!eventId)return ignore('the event has no id');
  const metadata=object?.metadata??{};
  const purchaseId=String(metadata.purchase_id??object?.client_reference_id??'').trim()||null;
  const playerId=String(metadata.player_id??'').trim()||null;
  if(type==='checkout.session.completed'||type==='checkout.session.async_payment_succeeded')
    return {action:'grant',type,eventId,purchaseId,playerId,
      sessionId:cleanStripeId(object?.id),paymentRef:cleanStripeId(object?.payment_intent),
      amountCents:Number(object?.amount_total),currency:String(object?.currency??'').toUpperCase(),
      // A card pays as the session completes; a delayed method completes unpaid and pays later, which is its
      // own event. Only 'paid' grants.
      paid:String(object?.payment_status??'')==='paid'};
  if(type==='checkout.session.expired')
    return {action:'expire',type,eventId,purchaseId,playerId,sessionId:cleanStripeId(object?.id),paymentRef:null};
  if(type==='charge.refunded')
    return {action:'refund',type,eventId,purchaseId,playerId,sessionId:null,
      paymentRef:cleanStripeId(object?.payment_intent),
      // A partial refund is still a refund of a pack that cannot be half-granted, so it is treated as one and
      // the admin page shows what Stripe actually sent back.
      partial:Boolean(object?.amount_refunded)&&Number(object.amount_refunded)<Number(object.amount)};
  if(type==='charge.dispute.created')
    return {action:'refund',type,eventId,purchaseId,playerId,sessionId:null,
      paymentRef:cleanStripeId(object?.payment_intent),disputed:true};
  return ignore(`${type||'that event'} is not one this endpoint acts on`);
}

// The webhook itself: verify, work out what it means, act once, write the event down.
//
// It acts before it records, deliberately. Recording first and then failing would leave an event marked as
// handled with the coins never granted, and Stripe's retry would be answered "already done". Acting first can
// at worst act twice, and acting twice is already harmless: grant_purchase allows one grant per purchase,
// refund_purchase only acts on a paid purchase, and cancel_purchase only on a pending one.
export function createStripeWebhook({store,env=stripeEnv(),providerId='stripe',now=()=>new Date(),log=console}={}){
  const done=(status,body)=>({status,body});
  const key=eventId=>`stripe:${eventId}`;
  return async function stripeWebhook({body,signature}={}){
    if(providerId!=='stripe')return done(503,{error:'Card payments are not switched on for this deployment.'});
    if(!env.ready)return done(503,{error:'Card payments are not configured on this deployment.'});
    if(body===null||body===undefined)
      return done(400,{error:'The raw request body is required to check the signature.'});
    const checked=verifyStripeSignature({payload:body,header:signature,secret:env.webhookSecret,now});
    if(!checked.ok)return done(400,{error:`Signature check failed: ${checked.error}`});
    let event=null;
    try{event=JSON.parse(Buffer.isBuffer(body)?body.toString('utf8'):String(body));}catch{}
    if(!event)return done(400,{error:'That body is not an event.'});
    const read=readStripeEvent(event);
    if(read.action==='ignore')return done(200,{received:true,ignored:read.reason});
    // The columns and the event log arrive with supabase/stripe.sql. Without them nothing can be written down,
    // so this answers 503 and Stripe retries it for three days, by which time the file has been run.
    if(!(await store.stripeReady?.()))return done(503,{error:new StripeNotReady().message});
    if(await store.paymentEventSeen(key(read.eventId)))
      return done(200,{received:true,repeat:true,event:read.eventId});

    const purchase=await findPurchase(store,read);
    if(!purchase)return note(200,{received:true,ignored:'no purchase of ours matches that payment'},read);
    // A webhook never touches a purchase somebody is paying by bank transfer, whatever it claims.
    if(purchase.provider!=='stripe')return note(200,{received:true,ignored:`${purchase.reference} is not a Stripe purchase`},read);
    if(read.playerId&&read.playerId!==purchase.player_id)
      return note(200,{received:true,refused:'the payment names a different player'},read);

    let result=null;
    if(read.action==='grant'){
      if(!read.paid)return note(200,{received:true,ignored:`${purchase.reference} is not paid yet`},read);
      // The money is checked against the purchase row, not against the metadata: the only numbers trusted are
      // the ones the server wrote when the purchase was made and the ones Stripe actually charged.
      const amount=Number(purchase.amount_cents)||0,currency=String(purchase.currency||COIN_CURRENCY).toUpperCase();
      if(read.amountCents!==amount||read.currency!==currency){
        log?.error?.(`[api/stripe] ${purchase.reference}: Stripe charged ${read.amountCents} ${read.currency}, the purchase is ${amount} ${currency}. Nothing granted.`);
        return note(200,{received:true,refused:'the amount does not match the purchase'},read);
      }
      await store.setPurchaseRefs(purchase.id,{sessionId:read.sessionId,paymentRef:read.paymentRef});
      result=await store.grantPurchase(purchase.id,'stripe');
    }else if(read.action==='refund'){
      result=await store.refundPurchase(purchase.id,'stripe');
    }else{
      // An abandoned checkout, expired by Stripe. Closing it here is what frees the player to buy again.
      result=await store.cancelPurchase(purchase.id,'stripe');
    }
    await store.recordPaymentEvent({id:key(read.eventId),provider:'stripe',type:read.type,purchaseId:purchase.id})
      .catch(error=>log?.error?.('[api/stripe] the event could not be written down',error));
    return done(200,{received:true,action:read.action,reference:purchase.reference,result});
  };
  // An event about a purchase we cannot place is worth a line in the log, and a 200: a retry would never find
  // it either.
  function note(status,body,read){
    if(body.ignored||body.refused)log?.warn?.(`[api/stripe] ${read.type} ${read.eventId}: ${body.ignored??body.refused}`);
    return done(status,body);
  }
}
// Which purchase an event is about. The id in the metadata is the direct answer; a refund or a dispute arrives
// as a charge, and those are traced through the payment intent stored when the session completed.
async function findPurchase(store,read){
  if(read.purchaseId){
    const byId=await store.purchaseById(read.purchaseId);
    if(byId)return byId;
  }
  for(const ref of [read.paymentRef,read.sessionId]){
    if(!ref)continue;
    const found=await store.purchaseByProviderRef(ref);
    if(found)return found;
  }
  return null;
}
