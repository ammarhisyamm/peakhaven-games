// How a coin pack gets paid for. Which provider is used is a deployment setting (ARCADE_PAYMENT_PROVIDER), so
// the rest of the arcade never knows or cares how the money arrived.
//
// A provider is an object with:
//   id                     short name, stored on the purchase row so an old purchase keeps its provider
//   ready                  false when the deployment has not been configured for it; the shop stays hidden
//   needsAdminConfirmation true when a human marks the purchase paid, false when the provider tells us
//   describe()             what the player is shown about paying: {kind, lines:[{label,value}], note}
//   async begin(purchase, {origin})
//                          called once the purchase row exists; returns {status, instructions, providerRef}
//                          status is 'pending' (wait for the money) or 'paid' (grant the coins now)
//   async resume(purchase, {origin})   optional
//                          a player who already has a payment waiting, asking again. Returns 'pending' with
//                          the instructions to carry on with, 'processing' when the money is in and the coins
//                          are moments away, or 'expired' when that attempt is dead and a new one should be
//                          started. A provider without it keeps the old behaviour: one payment at a time.
//
// Nothing here grants coins. Granting is public.grant_purchase, so it is idempotent and audited whether it was
// a person clicking "Mark paid" or a provider webhook.
import {paymentDetails,formatAmount} from './coins.mjs';
import {cleanSiteUrl,createStripeClient,returnUrl,stripeEnv} from './stripe.mjs';

// Bank transfer or PayID. The player sees the amount, a reference nobody else has, and where to send it; an
// admin matches the reference against the bank feed and marks it paid, which is what grants the coins.
export function createManualProvider(details=paymentDetails()){
  const lines=()=>[
    {label:'Account name',value:details.accountName},
    ...(details.bsb?[{label:'BSB',value:details.bsb}]:[]),
    ...(details.accountNumber?[{label:'Account number',value:details.accountNumber}]:[]),
    ...(details.payId?[{label:'PayID',value:details.payId}]:[]),
  ].filter(line=>line.value);
  return {
    id:'manual',
    ready:Boolean(details.ready),
    needsAdminConfirmation:true,
    describe(){
      return {kind:'manual',lines:lines(),
        note:details.instruction||'Put the reference in the payment description so we can match it. Coins are added once the transfer lands, usually within a day.'};
    },
    async begin(purchase){
      return {status:'pending',providerRef:null,
        instructions:{...this.describe(),amount:formatAmount(purchase.amount_cents),reference:purchase.reference}};
    },
  };
}

// Stripe Checkout. begin() creates a hosted Checkout Session for the pack's price in its own currency, with
// the purchase, the player and the reference in its metadata, and hands back the URL to send the player to.
// Nothing is granted here and nothing is granted when they come back: the coins are granted by the webhook in
// server/stripe.mjs, from an event whose signature has been checked. needsAdminConfirmation is false, which
// takes "Mark paid" off the admin page and leaves Cancel and Refund.
//
// It is not ready until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are both set, so a deployment that can
// take a payment but not verify one shows no shop at all.
export function createStripeProvider(env=process.env,{fetch=globalThis.fetch}={}){
  const settings=stripeEnv(env);
  const client=settings.ready?createStripeClient({secretKey:settings.secretKey,apiVersion:settings.apiVersion,fetch}):null;
  // Where Stripe sends the player back to. ARCADE_SITE_URL wins when it is set, for a deployment reached on a
  // host that is not the one the arcade is served from; otherwise it is the origin the request arrived on.
  const home=origin=>{
    const base=settings.siteUrl??cleanSiteUrl(origin);
    if(!base)throw new Error('Stripe needs somewhere to send the player back to. Set ARCADE_SITE_URL.');
    return base;
  };
  const urls=(purchase,origin)=>({
    successUrl:returnUrl(home(origin),{coins:'paid',ref:purchase.reference}),
    cancelUrl:returnUrl(home(origin),{coins:'cancelled',ref:purchase.reference}),
  });
  const checkout=(purchase,session)=>({...describe(),amount:formatAmount(purchase.amount_cents),
    reference:purchase.reference,checkoutUrl:session.url,sessionId:session.id});
  const describe=()=>({kind:'stripe',lines:[],
    note:'You will be taken to Stripe’s secure checkout page to pay by card, and brought straight back here. Your coins are added as soon as the payment goes through.'});
  return {
    id:'stripe',
    ready:settings.ready,
    needsAdminConfirmation:false,
    describe,
    async begin(purchase,{origin=null}={}){
      if(!client)throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
      const session=await client.createCheckoutSession({purchase,coins:purchase.coins,cents:purchase.amount_cents,
        currency:purchase.currency,playerId:purchase.player_id,...urls(purchase,origin)});
      return {status:'pending',providerRef:session.id,instructions:checkout(purchase,session)};
    },
    // The player tapped Buy again with a payment already waiting. A Checkout Session is still open for 24
    // hours, so the honest answer is usually the same page again rather than "finish the other one first".
    async resume(purchase,{origin=null}={}){
      if(!client||!purchase?.provider_ref)return null;
      let session=null;
      try{session=await client.getCheckoutSession(purchase.provider_ref);}catch{return null;}
      const status=String(session?.status??'');
      if(status==='open'&&session.url)return {status:'pending',instructions:checkout(purchase,session)};
      if(status==='expired')return {status:'expired'};
      // 'complete': the money is in and the webhook is on its way, so the coins are seconds away and starting
      // a second purchase would be wrong.
      return {status:'processing'};
    },
  };
}

export const PAYMENT_PROVIDERS={manual:createManualProvider,stripe:createStripeProvider};

// The provider this deployment uses. An unknown name is treated as nothing configured, which hides the shop
// rather than guessing at how to take someone's money.
export function createPaymentProvider(env=process.env){
  const name=String(env.ARCADE_PAYMENT_PROVIDER||'manual').trim().toLowerCase();
  const make=PAYMENT_PROVIDERS[name];
  if(!make)return {id:name||'none',ready:false,needsAdminConfirmation:true,describe(){return {kind:'none',lines:[],note:''};},
    async begin(){throw new Error(`Unknown payment provider ${name}.`);}};
  return name==='manual'?make(paymentDetails(env)):make(env);
}
