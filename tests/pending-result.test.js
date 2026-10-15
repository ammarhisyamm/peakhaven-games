import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingResultStore} from '../arcade/ui/pending-result.js';
test('Unsent replays survive reload, stay with their account, and tolerate unavailable storage',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const body={runId:'run-id',replay:{game:'blocks',seed:42,log:[]}};
 pendingResultStore(storage).set('a@example.test','blocks',body);
 const reload=pendingResultStore(storage);assert.deepEqual(reload.get('a@example.test').body,body);assert.equal(reload.get('b@example.test'),null);reload.clear('b@example.test');assert.ok(reload.get('a@example.test'));reload.clear('a@example.test');assert.equal(pendingResultStore(storage).get('a@example.test'),null);
 const blocked=pendingResultStore({getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}});blocked.set('a','blocks',body);assert.ok(blocked.get('a'));blocked.clear('a');assert.equal(blocked.get('a'),null);
});
