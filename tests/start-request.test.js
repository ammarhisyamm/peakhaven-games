import test from 'node:test';
import assert from 'node:assert/strict';
import {startRequestStore} from '../arcade/ui/start-request.js';
test('Uncertain starts reuse their ID through reload, scoped to account and game',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const first=startRequestStore(storage).id('a','blocks');assert.equal(startRequestStore(storage).id('a','blocks'),first);
 const next=startRequestStore(storage).id('b','blocks');assert.notEqual(next,first);assert.notEqual(startRequestStore(storage).id('b','sequence'),next);
 const ready=startRequestStore(storage);ready.clear();assert.notEqual(ready.id('a','blocks'),first);
});
