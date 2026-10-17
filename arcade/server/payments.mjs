// How a coin pack gets paid for. Which provider is used is a deployment setting (ARCADE_PAYMENT_PROVIDER), so
// the rest of the arcade never knows or cares how the money arrived.
//
// A provider is an object with:
//   id                     short name, stored on the purchase row so an old purchase keeps its provider
//   ready                  false when the deployment has not been configured for it; the shop stays hidden
//   needsAdminConfirmation true when a human marks the purchase paid, false when the provider tells us
//   describe()             what the player is shown about paying: {kind, lines:[{label,value}], note}
//   async begin(purchase)  called once the purchase row exists; returns {status, instructions, providerRef}
//                          status is 'pending' (wait for the money) or 'paid' (grant the coins now)
//
// Nothing here grants coins. Granting is public.grant_purchase, so it is idempotent and audited whether it was
// a person clicking "Mark paid" or a provider webhook.
import {paymentDetails,formatAmount} from './coins.mjs';

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

// Stripe, for later. Nothing is implemented and the stripe package is deliberately not a dependency yet: this
// is here so the shape of the work is settled and nothing else has to change when it is done.
//
// A Stripe provider would: create a Checkout Session in begin() for pack.cents in COIN_CURRENCY with the
// purchase id in its metadata, return {status:'pending', providerRef:<session id>, instructions:{kind:'stripe',
// checkoutUrl}}, and add one webhook route that verifies the signature and calls store.grantPurchase(
// purchase_id, 'stripe') on checkout.session.completed. grant_purchase is already idempotent, so a webhook
// Stripe sends twice grants once. needsAdminConfirmation would be false, which hides "Mark paid" on the admin
// page and leaves Cancel and Refund.
export function createStripeProvider(){
  return {
    id:'stripe',
    ready:false,
    needsAdminConfirmation:false,
    describe(){return {kind:'stripe',lines:[],note:'Card payments are not switched on yet.'};},
    async begin(){throw new Error('The Stripe provider is not implemented yet. Set ARCADE_PAYMENT_PROVIDER=manual.');},
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
