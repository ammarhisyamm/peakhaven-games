// Play credits are separate from cosmetic/reward coins. One credit starts one run.
export const PLAY_CREDIT_KEY='ph-arcade-play-credits-v1';
export const PLAY_GAMES=['blocks','sequence','ridge'];
export const COIN_PACKS=[{coins:1,price:'A$2.99'},{coins:5,price:'A$9.99'},{coins:10,price:'A$17.99',popular:true},{coins:25,price:'A$29.99'}];
const day=date=>`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
export function playWallet(storage=globalThis.localStorage,date=new Date()){
 const today=day(date);let raw;
 try{raw=JSON.parse(storage.getItem(PLAY_CREDIT_KEY)||'null');}catch{}
 if(!raw){
  let legacy;try{legacy=JSON.parse(storage.getItem('ph-clean-concept-v2')||'{}').dailyPlays;}catch{}
  raw={date:today,used:legacy?.date===today?legacy.used:{},coins:0};
 }
 return {version:1,date:today,used:Object.fromEntries(PLAY_GAMES.map(id=>[id,raw.date===today?Math.min(3,count(raw.used?.[id])):0])),coins:count(raw.coins)};
}
export function freePlaysLeft(id,storage=globalThis.localStorage,date=new Date()){
 return PLAY_GAMES.includes(id)?3-playWallet(storage,date).used[id]:0;
}
export function availablePlays(id,storage=globalThis.localStorage,date=new Date()){
 const w=playWallet(storage,date);return freePlaysLeft(id,storage,date)+w.coins;
}
function write(wallet,storage){try{storage.setItem(PLAY_CREDIT_KEY,JSON.stringify(wallet));return true;}catch{return false;}}
export function consumePlay(id,storage=globalThis.localStorage,date=new Date()){
 if(!PLAY_GAMES.includes(id))return {ok:false,reason:'game'};
 const w=playWallet(storage,date);let source;
 if(w.used[id]<3){w.used[id]++;source='free';}
 else if(w.coins>0){w.coins--;source='coin';}
 else return {ok:false,reason:'empty',wallet:w};
 if(!write(w,storage))return {ok:false,reason:'storage',wallet:playWallet(storage,date)};
 return {ok:true,source,wallet:w};
}
export function simulateCoinPurchase(coins,storage=globalThis.localStorage,date=new Date()){
 if(!COIN_PACKS.some(p=>p.coins===coins))return {ok:false,reason:'pack'};
 const wallet=playWallet(storage,date);wallet.coins+=coins;
 return write(wallet,storage)?{ok:true,wallet}:{ok:false,reason:'storage'};
}
