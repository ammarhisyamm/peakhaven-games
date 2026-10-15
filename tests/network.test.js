import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON} from '../arcade/ui/network.js';
test('API errors settle for offline, proxy HTML, malformed data and timeout',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{throw Error('offline');};assert.equal((await requestJSON('/api/me')).status,0);
  globalThis.fetch=async()=>new Response('bad gateway',{status:502});assert.equal((await requestJSON('/api/finish')).retryable,true);
  globalThis.fetch=async()=>new Response('null');assert.equal((await requestJSON('/api/start')).ok,false);
  globalThis.fetch=(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))));
  const timeout=await requestJSON('/api/finish',{},10);assert.match(timeout.error,/too long/);assert.equal(timeout.retryable,true);
  globalThis.fetch=async()=>Response.json({error:'Invalid invite'},{status:403});assert.equal((await requestJSON('/api/join')).retryable,false);
  globalThis.fetch=async()=>Response.json({score:12});assert.equal((await requestJSON('/api/finish')).score,12);
 }finally{globalThis.fetch=original;}
});
