import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAY_CREDIT_KEY,playWallet,freePlaysLeft,consumePlay,simulateCoinPurchase} from '../dist/play-credits.js';
const date=new Date(2026,9,14,12);
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('each game has three free plays and consumes a shared coin only after its free plays',()=>{
 const s=storage();simulateCoinPurchase(5,s,date);
 for(let i=0;i<3;i++)assert.equal(consumePlay('blocks',s,date).source,'free');
 assert.equal(playWallet(s,date).coins,5);assert.equal(consumePlay('blocks',s,date).source,'coin');
 assert.equal(playWallet(s,date).coins,4);assert.equal(freePlaysLeft('ridge',s,date),3);
 for(let i=0;i<3;i++)consumePlay('ridge',s,date);
 assert.equal(consumePlay('ridge',s,date).source,'coin');assert.equal(playWallet(s,date).coins,3);
});
test('empty wallets reject a run and a day rollover restores free plays while retaining credits',()=>{
 const s=storage();for(let i=0;i<3;i++)consumePlay('sequence',s,date);
 assert.equal(consumePlay('sequence',s,date).ok,false);
 simulateCoinPurchase(10,s,date);const tomorrow=new Date(2026,9,15,0,1);
 assert.equal(freePlaysLeft('sequence',s,tomorrow),3);assert.equal(playWallet(s,tomorrow).coins,10);
});
test('existing daily play usage migrates without giving already used plays back',()=>{
 const s=storage();s.setItem('ph-clean-concept-v2',JSON.stringify({dailyPlays:{date:'2026-10-14',used:{blocks:2,ridge:3}}}));
 assert.equal(freePlaysLeft('blocks',s,date),1);assert.equal(consumePlay('blocks',s,date).source,'free');
 assert.equal(freePlaysLeft('blocks',s,date),0);assert.equal(freePlaysLeft('ridge',s,date),0);
 assert.ok(s.getItem(PLAY_CREDIT_KEY));
});
test('failed storage cannot start a run or pretend a purchase succeeded',()=>{
 const s={getItem:()=>null,setItem:()=>{throw Error('blocked');}};
 assert.deepEqual(consumePlay('blocks',s,date).reason,'storage');
 assert.equal(simulateCoinPurchase(10,s,date).ok,false);
});
test('only the four reference coin packs are accepted',()=>{
 const s=storage();for(const n of [1,5,10,25])assert.equal(simulateCoinPurchase(n,s,date).ok,true);
 assert.equal(playWallet(s,date).coins,41);assert.equal(simulateCoinPurchase(999,s,date).ok,false);
});

test('non-finite persisted counts cannot create an unlimited wallet',()=>{
 const s=storage();s.setItem(PLAY_CREDIT_KEY,JSON.stringify({date:'2026-10-14',used:{blocks:'Infinity'},coins:'Infinity'}));
 assert.equal(playWallet(s,date).coins,0);assert.equal(freePlaysLeft('blocks',s,date),3);
});
