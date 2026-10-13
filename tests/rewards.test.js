// Reward rules: run payouts and the boost, first-win gems, daily claims against clock changes,
// the Ice Flow unlock, the chest calendar, and saved values that must never reach the page as HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SKINS,normalizeCollection,claimDaily,claimSpin,skinUnlocked,buySkin,runLoot,dailySchedule,puzzleClears} from '../dist/collection.js';

test('a lost puzzle level pays nothing',()=>{const r=runLoot({coins:5},false,false,0);assert.equal(r.coins,0);assert.equal(r.data.coins,5);});
test('puzzle wins pay 20 coins, and a gem only on a first win',()=>{
  assert.deepEqual([runLoot({},true,false).coins,runLoot({},true,false).gems],[20,0]);
  assert.deepEqual([runLoot({},true,true).coins,runLoot({},true,true).gems],[20,1]);
});
test('endless runs pay their coins through the boost, which doubles them and uses up a game',()=>{
  const plain=runLoot({coins:0},false,false,15);assert.equal(plain.coins,15);assert.equal(plain.gems,0,'no gems from endless runs');
  const boosted=runLoot({coins:0,boostRuns:5},false,false,15);assert.equal(boosted.coins,30);assert.equal(boosted.data.boostRuns,4);
  assert.equal(runLoot({boostRuns:5},false,false,0).data.boostRuns,5,'a run that pays nothing keeps the boost');
  assert.equal(runLoot({},false,false,NaN).coins,0);
});
test('daily chest rejects a wound-back clock but allows the next real day',()=>{
  const first=claimDaily({},'2026-10-13').data;
  assert.equal(claimDaily(first,'2026-10-13').ok,false,'same day');
  assert.equal(claimDaily(first,'2026-10-01').ok,false,'clock wound back');
  const next=claimDaily(first,'2026-10-14');assert.equal(next.ok,true);assert.equal(next.data.claimStreak,2);assert.equal(next.coins,60);
});
test('daily chest streak caps at 110 coins and survives month and year ends',()=>{
  let d={};const days=['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04','2027-01-05'];
  for(const day of days)d=claimDaily(d,day).data;assert.equal(d.claimStreak,9);assert.equal(d.lastDailyCoins,110);
});
test('daily chest adds XP even when a save has no xp field',()=>{assert.equal(claimDaily({},'2026-10-13').data.xp,10);});
test('free spin rejects a wound-back clock and keeps slots in range',()=>{
  const d=claimSpin({},'2026-10-13',.5).data;assert.equal(claimSpin(d,'2026-10-12',.5).ok,false);
  for(const r of [-1,0,.999,1,5])assert.ok(claimSpin({},'2026-10-13',r).slot>=0&&claimSpin({},'2026-10-13',r).slot<=5);
});
test('Ice Flow unlocks after clearing 3 new puzzle levels, and old mission saves still count',()=>{
  const ice=SKINS.find(s=>s.id==='ice');
  assert.equal(skinUnlocked({xp:0,claimStreak:0,gameLevels:{sort:2,mahjong:2,sequence:1}},ice),false);
  assert.equal(skinUnlocked({xp:0,claimStreak:0,gameLevels:{sort:2,mahjong:2,sequence:2}},ice),true);
  assert.equal(skinUnlocked({xp:0,claimStreak:0,completed:[0,1,2]},ice),true);
  assert.equal(puzzleClears({}),0);
  assert.doesNotThrow(()=>skinUnlocked({},ice),'missing fields no longer throw');
  assert.equal(buySkin({gameLevels:{sort:4}},'ice').ok,true);
});
test('the chest calendar follows the real claim streak',()=>{
  assert.deepEqual(dailySchedule({},'2026-10-13'),[50,60,70,80,90]);
  const yesterday={claimDay:'2026-10-12',claimStreak:3};assert.deepEqual(dailySchedule(yesterday,'2026-10-13'),[80,90,100,110,110]);
  const today={claimDay:'2026-10-13',claimStreak:3};assert.deepEqual(dailySchedule(today,'2026-10-13').slice(0,2),[70,80]);
  const lapsed={claimDay:'2026-10-01',claimStreak:6};assert.deepEqual(dailySchedule(lapsed,'2026-10-13')[0],50);
});
test('a tampered lastDailyCoins can never be rendered as HTML',()=>{
  const d=normalizeCollection({lastDailyCoins:'<img src=x onerror=alert(1)>'});assert.equal(typeof d.lastDailyCoins,'number');
});
