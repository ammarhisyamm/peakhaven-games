import test from 'node:test';
import assert from 'node:assert/strict';
import {withGuestMode} from '../arcade/ui/guest-mode.js';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
function fixture(){let signed=false,change,calls=0;return {account:{enabled:true,signedIn:()=>signed,onChange:fn=>change=fn,api:async()=>{calls++;return {ok:true};},signOut:async()=>{signed=false;change();}},signIn:()=>{signed=true;change?.();},calls:()=>calls};}
test('guest uses prototype mode and cannot submit competition requests',async()=>{
 const f=fixture(),a=withGuestMode(f.account,storage());let updates=0;a.onChange(()=>updates++);
 assert.equal(a.enabled,true);a.continueAsGuest();assert.equal(a.isGuest(),true);assert.equal(a.enabled,false);assert.equal(a.signedIn(),false);
 assert.equal((await a.api('start',{body:{game:'blocks'}})).ok,false);assert.equal(f.calls(),0);assert.equal(updates,1);
 a.leaveGuest();assert.equal(a.enabled,true);assert.equal(a.signedIn(),false);assert.equal((await a.api('me')).ok,true);
});
test('guest survives a tab reload, and a real sign-in restores account mode',()=>{
 const f=fixture(),s=storage();withGuestMode(f.account,s).continueAsGuest();const a=withGuestMode(f.account,s);
 assert.equal(a.isGuest(),true);f.signIn();assert.equal(a.isGuest(),false);assert.equal(a.enabled,true);assert.equal(a.signedIn(),true);assert.equal(s.getItem('ph-arcade-guest-session'),null);
});
test('a saved real account takes precedence over a stale guest marker',()=>{
 const f=fixture(),s=storage();s.setItem('ph-arcade-guest-session','1');f.signIn();const a=withGuestMode(f.account,s);
 assert.equal(a.isGuest(),false);assert.equal(a.enabled,true);assert.equal(s.getItem('ph-arcade-guest-session'),null);
});
test('guest entry works when session storage is blocked',()=>{
 const f=fixture(),s={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');},removeItem:()=>{throw Error('blocked');}};
 const a=withGuestMode(f.account,s);a.continueAsGuest();assert.equal(a.isGuest(),true);a.leaveGuest();assert.equal(a.enabled,true);
});
