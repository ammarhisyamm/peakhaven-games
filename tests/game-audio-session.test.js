// The iPhone silent-switch fix. Web Audio on iOS plays into an "ambient" session that the ringer switch
// mutes, which is why testers on phones heard nothing at all. Two things lift a page out of ambient, and
// these tests hold both of them to the rules iOS actually applies: claim the session, keep a silent loop
// playing, and re-arm whenever an interruption takes either away.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioSession,silentWavUri,GESTURES} from '../dist/audio-session.js';

function fakeElement(){
 return {loop:false,playsInline:false,preload:'',volume:0,src:'',paused:true,plays:0,pauses:0,attrs:{},style:{},
  setAttribute(k,v){this.attrs[k]=v;},remove(){this.removed=true;},
  play(){this.plays++;this.paused=false;return Promise.resolve();},
  pause(){this.pauses++;this.paused=true;}};
}
function fakeDoc(){
 const listeners=new Map(),made=[];
 const body={children:[],append(el){body.children.push(el);}};
 return {
  hidden:false,body,made,
  createElement(){const el=fakeElement();made.push(el);return el;},
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
  removeEventListener(name,fn){const list=listeners.get(name)||[],i=list.indexOf(fn);if(i>=0)list.splice(i,1);},
  fire(name){for(const fn of [...(listeners.get(name)||[])])fn();},
  bound(name){return (listeners.get(name)||[]).length;},
 };
}
function fakeNav({supported=true,throws=false}={}){
 const types=[],nav={types};
 if(supported)nav.audioSession={get type(){return types.at(-1)??'auto';},set type(v){if(throws)throw new Error('nope');types.push(v);}};
 return nav;
}

test('the silent loop really is a playable WAV, not an empty src',()=>{
 const uri=silentWavUri();
 assert.ok(uri.startsWith('data:audio/wav;base64,'),uri.slice(0,40));
 const bytes=Buffer.from(uri.slice('data:audio/wav;base64,'.length),'base64');
 assert.equal(bytes.subarray(0,4).toString('latin1'),'RIFF');
 assert.equal(bytes.subarray(8,12).toString('latin1'),'WAVE');
 // 8-bit PCM silence is 128, not 0: a file full of zeroes is a click on some decoders.
 assert.ok(bytes.subarray(44).every(b=>b===128),'the samples are silence');
 assert.ok(bytes.length<4000,`small enough to inline, got ${bytes.length} bytes`);
});

test('a gesture claims the playback session and starts exactly one silent loop',()=>{
 const doc=fakeDoc(),nav=fakeNav(),session=createAudioSession({document:doc,navigator:nav});
 assert.equal(session.element,null);
 session.resume();
 assert.deepEqual(nav.types,['playback']);
 const el=session.element;
 assert.equal(doc.made.length,1);
 assert.equal(el.loop,true);
 assert.equal(el.playsInline,true);
 assert.equal(el.attrs.playsinline,'');
 assert.equal(el.volume,1,'silence at full volume: the point is to hold the session, not to be heard');
 assert.ok(el.src.startsWith('data:audio/wav'));
 assert.equal(el.plays,1);
 assert.equal(doc.body.children.length,1,'the element is in the page, or iOS ignores it');
 // A second tap must not pile up elements or restart a loop that is already running.
 session.resume();
 assert.equal(doc.made.length,1);
 assert.equal(el.plays,1);
 assert.deepEqual(nav.types,['playback','playback']);
});

test('an interruption costs one tap, not a reload',()=>{
 const doc=fakeDoc(),session=createAudioSession({document:doc,navigator:fakeNav()});
 session.resume();
 const el=session.element;
 // A call, Siri, locking the phone: iOS pauses the element and suspends the context.
 el.paused=true;
 session.resume();
 assert.equal(el.plays,2,'the same element is played again');
 assert.equal(doc.made.length,1,'and no second element is created');
});

test('every gesture iOS counts is armed, and the page coming back re-arms it',()=>{
 const doc=fakeDoc(),nav=fakeNav(),session=createAudioSession({document:doc,navigator:nav});
 const stop=session.listen(doc);
 for(const name of GESTURES)assert.equal(doc.bound(name),1,`${name} is armed`);
 assert.ok(GESTURES.includes('touchend')&&GESTURES.includes('click'),'iOS only counts these two for play()');
 for(const name of GESTURES)doc.fire(name);
 assert.equal(nav.types.length,GESTURES.length,'each gesture re-claims the session');
 const el=session.element;
 el.paused=true;doc.hidden=false;doc.fire('visibilitychange');
 assert.equal(el.plays,2,'coming back to the page restarts the loop');
 el.paused=true;doc.hidden=true;doc.fire('visibilitychange');
 assert.equal(el.plays,2,'but going away does not');
 stop();
 for(const name of GESTURES)assert.equal(doc.bound(name),0,'and it all comes off again');
 session.listen(doc);
 assert.equal(doc.bound('click'),1,'listen can be armed again after that');
});

test('muting hands the session back, so the player gets their own music',()=>{
 const doc=fakeDoc(),nav=fakeNav(),session=createAudioSession({document:doc,navigator:nav});
 session.resume();
 assert.equal(session.claimed,true);
 session.release();
 assert.equal(session.claimed,false);
 assert.equal(session.element.paused,true);
 assert.equal(nav.types.at(-1),'auto');
 // Unmuting is one more resume, not a new element.
 session.resume();
 assert.equal(doc.made.length,1);
 assert.equal(nav.types.at(-1),'playback');
});

test('a browser without navigator.audioSession still gets the loop, and a throwing one does not break',()=>{
 const bare=createAudioSession({document:fakeDoc(),navigator:fakeNav({supported:false})});
 bare.resume();
 assert.equal(bare.claimed,false);
 assert.equal(bare.element.plays,1,'older iOS has only the loop, so the loop has to work on its own');
 const hostile=createAudioSession({document:fakeDoc(),navigator:fakeNav({throws:true})});
 hostile.resume();
 assert.equal(hostile.claimed,false);
 assert.equal(hostile.element.plays,1);
 // No document at all (a server-side import, a test): nothing throws.
 const headless=createAudioSession({document:null,navigator:null});
 assert.equal(headless.resume(),false);
 assert.doesNotThrow(()=>{headless.release();headless.listen(null);headless.destroy();});
});

test('GameAudio claims the session as it prepares the context, and not while muted',async()=>{
 globalThis.window??={};
 globalThis.window.AudioContext=class{
  state='running';currentTime=0;
  createBufferSource(){return {buffer:null,playbackRate:{value:1},connect(){},start(){}};}
  createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
  decodeAudioData(){return Promise.resolve({});}
  resume(){return Promise.resolve();}
 };
 globalThis.fetch??=()=>Promise.reject(new Error('no network in this test'));
 const {GameAudio}=await import('../dist/game-audio.js');
 let claims=0;
 const session={resume(){claims++;return true;},release(){},claim(){return true;},listen(){return()=>{};}};
 let enabled=false;
 const audio=new GameAudio(()=>enabled,session);
 audio.prepare();
 assert.equal(claims,0,'a muted game must not take the audio session from anything else');
 enabled=true;
 audio.prepare();
 assert.equal(claims,1);
 audio.play('blocks','clear3');
 assert.ok(claims>=2,'and every cue checks it again, because an interruption may have taken it');
 audio.stop();
});
