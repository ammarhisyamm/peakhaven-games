// What a player should be shown about coins, as plain data, so every combination is covered by tests
// with no browser. The rule this file exists to hold: the BUY flow needs somewhere to send money, a
// BALANCE does not. Coins an admin granted are shown and spent on a deployment that sells nothing, so
// nothing here may gate a balance, or a paid run, on whether the shop is open.
export function walletView({enabled=false,signedIn=false,isGuest=false,coinsReady=false,coins=0,shopEnabled=false}={}){
 const live=Boolean(enabled)&&Boolean(signedIn)&&Boolean(coinsReady);
 return {
  // A wallet belongs on screen once the coin tables exist, even at nil: "0 coins" is an answer, a
  // missing wallet is not, and a player who was granted one coin must be able to find it.
  showBalance:live,
  coins:live?Math.max(0,Math.floor(Number(coins)||0)):0,
  showShop:Boolean(enabled)&&Boolean(signedIn)&&Boolean(shopEnabled),
  // A guest's only sign-in control used to live in the page footer, which the Play page hides.
  showSignIn:Boolean(isGuest)||(Boolean(enabled)&&!signedIn),
 };
}
// What the game offers when its three free plays are gone. A coin starts a run whatever the shop is doing.
export function playOffer({freePlaysLeft=0,coins=0}={}){
 const free=Math.max(0,Math.floor(Number(freePlaysLeft)||0)),paid=Math.max(0,Math.floor(Number(coins)||0));
 if(free)return {canStart:true,paid:false,text:`${free} play${free===1?'':'s'} left today`};
 if(paid)return {canStart:true,paid:true,text:`No free plays left · uses 1 of your ${paid} coin${paid===1?'':'s'}`};
 return {canStart:false,paid:false,text:'No plays left today, back at midnight'};
}
