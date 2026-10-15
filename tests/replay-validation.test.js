import test from 'node:test';
import assert from 'node:assert/strict';
import {SIM_STEP} from '../dist/rng.js';
import {verifySegment,RejectedRun} from '../arcade/server/verify.mjs';
const seed=123;
test('Malformed replay clocks reject cleanly instead of scoring a truncated log',async()=>{
 for(const endTick of [-1,.5,null,Infinity,432001]){
  const replay={v:4,game:'ridge',seed,step:SIM_STEP,taps:[],endTick};
  await assert.rejects(verifySegment({game:'ridge',replay,seed,level:1,elapsedSeconds:1}),RejectedRun);
 }
 for(const taps of [[-1],[.5],[1],['0']]){
  const replay={v:4,game:'ridge',seed,step:SIM_STEP,taps,endTick:0};
  await assert.rejects(verifySegment({game:'ridge',replay,seed,level:1,elapsedSeconds:1}),RejectedRun);
 }
});
test('A legitimate Ridge tap immediately followed by Finish remains verifiable',async()=>{
 const replay={v:4,game:'ridge',seed,step:SIM_STEP,taps:[0],resumes:[],endTick:0};
 assert.equal((await verifySegment({game:'ridge',replay,seed,level:1,elapsedSeconds:1})).score,0);
});
