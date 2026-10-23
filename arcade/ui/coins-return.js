// Coming back from a hosted checkout, as plain data, so every state is covered by tests with no browser.
//
// The rule this file exists to hold: **the redirect is not a receipt.** Landing on the success address proves
// only that a browser visited an address; the coins are granted by the webhook in server/stripe.mjs, from an
// event whose signature was checked. So nothing here adds a coin or says one was added — it reads /api/me
// until the balance the server reports has caught up, and says plainly when it has not.
const REFERENCE=/^[A-Z0-9][A-Z0-9-]{2,15}$/;
export const RETURN_STATES=Object.freeze(['paid','cancelled']);
// How many times /api/me is asked before the player is told it is taking longer than usual. A webhook
// normally lands while Stripe is still showing its own "payment complete" page, so this is seconds, not
// minutes, and giving up only changes the wording: the coins still arrive.
export const MAX_ATTEMPTS=8;

// Whether this page load is a return from a checkout, from the query the provider sent the player back with
// (?coins=paid&ref=PHA-XXXX). The query is used rather than the fragment because ui/account.js rewrites the
// fragment when a sign-in link is followed, which would take this with it.
export function checkoutReturn(search){
  const params=new URLSearchParams(String(search??'').replace(/^\?/,''));
  const state=String(params.get('coins')??'').trim().toLowerCase();
  if(!RETURN_STATES.includes(state))return null;
  const raw=String(params.get('ref')??'').trim().toUpperCase();
  return {state,reference:REFERENCE.test(raw)?raw:null};
}

// What to show, given the wallet /api/me just reported. `attempts` is how many times it has been asked.
export function checkoutProgress({state=null,reference=null,purchases=[],coins=0,attempts=0,maxAttempts=MAX_ATTEMPTS}={}){
  const balance=Math.max(0,Math.floor(Number(coins)||0));
  const rows=Array.isArray(purchases)?purchases:[];
  // Without a reference the best that can be done is the newest purchase, which is the one just paid for
  // unless the player has been buying in two tabs.
  const mine=reference?rows.find(p=>String(p?.reference??'').toUpperCase()===reference)
    :[...rows].sort((a,b)=>String(a?.createdAt??'').localeCompare(String(b?.createdAt??''))).at(-1)??null;
  const added=Math.max(0,Math.floor(Number(mine?.coins)||0));
  if(state==='cancelled')return {phase:'cancelled',done:true,poll:false,coins:balance,added:0,reference,
    title:'Payment cancelled',
    body:'Nothing has been charged. Your coins are exactly as they were, and the packs are still there when you want one.'};
  if(state!=='paid')return null;
  if(mine?.status==='paid')return {phase:'added',done:true,poll:false,coins:balance,added,reference,
    title:'Coins added',
    body:`${added} coin${added===1?'':'s'} ${added===1?'is':'are'} in your balance${balance?`, which is now ${balance} coin${balance===1?'':'s'}`:''}. One coin starts one extra run of any game, once that game’s free plays for the day are gone.`};
  if(mine?.status==='refunded')return {phase:'refunded',done:true,poll:false,coins:balance,added:0,reference,
    title:'That payment was refunded',
    body:'Nothing was added. If that is not what you expected, reply to your receipt and we will sort it out.'};
  if(mine?.status==='cancelled')return {phase:'cancelled',done:true,poll:false,coins:balance,added:0,reference,
    title:'That payment was cancelled',
    body:'Nothing has been charged. The packs are still there when you want one.'};
  // Paid at Stripe, not landed here yet. Worth saying out loud that the money is not at risk, because the
  // one thing a player must not do is pay again.
  if(attempts<maxAttempts)return {phase:'waiting',done:false,poll:true,coins:balance,added,reference,
    title:'Confirming your payment',
    body:'This usually takes a few seconds. Please keep this page open.'};
  return {phase:'slow',done:true,poll:false,coins:balance,added,reference,
    title:'Payment received, coins on their way',
    body:`Your payment has gone through and your coins are still being added${reference?` (${reference})`:''}. They will appear on their own — please do not pay again. If they are not there in a few minutes, get in touch and quote that reference.`};
}
