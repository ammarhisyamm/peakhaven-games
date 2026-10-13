export const SKINS=[
{id:'classic',name:'PH Original',requirement:'Your first bottle. Always yours.'},
{id:'cyan',name:'Sky Molecule',xp:40,requirement:'Earn 40 XP to unlock.'},
{id:'hex',name:'Deep Hex',coins:150,requirement:'Unlock with 150 game coins.'},
{id:'ice',name:'Ice Flow',puzzleClears:3,requirement:'Clear 3 new puzzle levels to unlock.'},
{id:'gold',name:'Golden Peak',streak:7,requirement:'Collect your daily reward 7 days in a row.'},
{id:'violet',name:'Violet Bloom',gems:10,requirement:'Unlock with 10 game gems.'}];
export const boostCost=60;
export function normalizeCollection(input){const d={coins:0,gems:0,skins:['classic'],skin:'classic',claimDay:'',claimStreak:0,spinDay:'',boostRuns:0,playerName:'HavenPlayer',mergeToday:0,mergeDay:'',lastDailyCoins:50,...input};for(const k of ['coins','gems','claimStreak','boostRuns','mergeToday','lastDailyCoins'])d[k]=Number.isFinite(d[k])?Math.max(0,Math.floor(d[k])):0;d.skins=Array.isArray(d.skins)?[...new Set(['classic',...d.skins.filter(id=>SKINS.some(s=>s.id===id))])]:['classic'];if(!d.skins.includes(d.skin))d.skin='classic';d.playerName=typeof d.playerName==='string'&&d.playerName.trim()?d.playerName.slice(0,20):'HavenPlayer';return d;}
function previousDay(day){const [y,m,d]=day.split('-').map(Number),date=new Date(y,m-1,d);date.setDate(date.getDate()-1);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
// Dates are YYYY-MM-DD, so string order is date order. A day before the last claim means the clock was wound back.
export function claimDaily(input,day){const d=normalizeCollection(input);if(d.claimDay&&day<=d.claimDay)return {ok:false,data:d};const streak=d.claimDay===previousDay(day)?d.claimStreak+1:1;const coins=Math.min(50+(streak-1)*10,110);return {ok:true,coins,data:{...d,claimDay:day,claimStreak:streak,lastDailyCoins:coins,coins:d.coins+coins,gems:d.gems+1,xp:(Number.isFinite(d.xp)?d.xp:0)+10}};}
export function claimSpin(input,day,random){const d=normalizeCollection(input);if(d.spinDay&&day<=d.spinDay)return {ok:false,data:d};const slot=Math.min(5,Math.max(0,Math.floor(random*6))),amount=[20,40,1,60,2,30][slot],currency=slot===2||slot===4?'gems':'coins';return {ok:true,slot,amount,currency,data:{...d,spinDay:day,[currency]:d[currency]+amount}};}
// New puzzle levels cleared. Old saves may hold mission IDs in `completed`; nothing writes those any more.
export function puzzleClears(d){const levels=Object.values(d.gameLevels||{}).reduce((n,v)=>n+Math.max(0,(Number(v)||1)-1),0);return Math.max(levels,Array.isArray(d.completed)?d.completed.length:0);}
export function skinUnlocked(d,s){return !(s.xp&&!(d.xp>=s.xp)||s.puzzleClears&&puzzleClears(d)<s.puzzleClears||s.streak&&!(d.claimStreak>=s.streak));}
// The chest amounts for today and the next few days, following the real claim streak.
export function dailySchedule(input,day,count=5){const d=normalizeCollection(input),claimedToday=d.claimDay===day,next=claimedToday?d.claimStreak:d.claimDay===previousDay(day)?d.claimStreak+1:1;return Array.from({length:count},(_,i)=>Math.min(50+(next-1+i)*10,110));}
export function buySkin(input,id){const d=normalizeCollection(input),s=SKINS.find(x=>x.id===id);if(!s)return {ok:false,data:d,reason:'Bottle not found.'};if(d.skins.includes(id))return {ok:true,data:d};if(!skinUnlocked(d,s))return {ok:false,data:d,reason:s.requirement};if(s.coins&&d.coins<s.coins||s.gems&&d.gems<s.gems)return {ok:false,data:d,reason:'Earn more rewards through play to unlock this bottle.'};return {ok:true,data:{...d,coins:d.coins-(s.coins||0),gems:d.gems-(s.gems||0),skins:[...d.skins,id]}};}
// Coins for one finished game: 20 for a puzzle win plus any endless-run coins. The boost doubles the total and
// uses up one boosted game whenever coins are paid, for puzzle and endless games alike.
export function runLoot(input,won,firstWin=false,runCoins=0){const d=normalizeCollection(input),base=(won?20:0)+Math.max(0,Math.floor(runCoins)||0);if(!base)return {data:d,coins:0,gems:0};const coins=d.boostRuns?base*2:base,gems=won&&firstWin?1:0;return {coins,gems,data:{...d,coins:d.coins+coins,gems:d.gems+gems,boostRuns:Math.max(0,d.boostRuns-1)}};}
