// iOS puts a page's Web Audio in the "ambient" audio session, which the ringer/silent switch mutes.
// No amount of AudioContext work changes that, which is why testers on iPhones heard nothing at all.
// Two things lift a page out of ambient, and this module does both:
//  * navigator.audioSession.type = 'playback' — the declarative route (Safari 16.4+ / iOS 16.4+);
//  * a looping <audio> element that is really playing — what older iOS reads as "this page is playing
//    media" and routes to the media channel. The track is silence, so it is never heard; it only
//    holds the session open.
// Both need a real user gesture, and iOS only counts click/touchend for media playback (pointerdown
// is enough for AudioContext.resume but not always for play()), so `listen` arms on all of them and
// re-arms whenever the page comes back: an interruption (a call, Siri, locking the phone, switching
// apps) pauses the element and leaves the context suspended.
// Trade-off: 'playback' tells iOS this page is media, so it interrupts the player's own music. That is
// the same deal every mobile game with sound takes, and it is the only session type the switch ignores.

// A fraction of a second of 8 kHz 8-bit silence, built here so there is no asset to fetch and no
// multi-kilobyte literal in the source. 8-bit PCM silence is 128, not 0.
export function silentWavUri(seconds=.25,rate=8000){
 const samples=Math.max(1,Math.round(seconds*rate)),bytes=new Uint8Array(44+samples),view=new DataView(bytes.buffer);
 const text=(at,value)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
 text(0,'RIFF');view.setUint32(4,36+samples,true);text(8,'WAVEfmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,rate,true);view.setUint32(28,rate,true);view.setUint16(32,1,true);view.setUint16(34,8,true);
 text(36,'data');view.setUint32(40,samples,true);bytes.fill(128,44);
 let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);
 return typeof btoa==='function'?`data:audio/wav;base64,${btoa(raw)}`:'';
}

// Every gesture that counts as user activation somewhere. touchend and click are the ones iOS accepts
// for play(); pointerdown is the earliest one, so the context resumes on the same tap that asked for a cue.
export const GESTURES=Object.freeze(['pointerdown','touchend','click','keydown']);

export function createAudioSession(env={}){
 const doc=env.document??(typeof document==='undefined'?null:document);
 const nav=env.navigator??(typeof navigator==='undefined'?null:navigator);
 let element=null,claimed=false,listening=null,uri=null;
 const session={
  get element(){return element;},
  get claimed(){return claimed;},
  get listening(){return Boolean(listening);},
  // The supported route change. Browsers without navigator.audioSession fall back to the loop below.
  claim(){
   if(!nav?.audioSession)return false;
   try{nav.audioSession.type='playback';claimed=true;}catch{claimed=false;}
   return claimed;
  },
  // Call from inside a user gesture. Idempotent: one element per page, replayed whenever iOS paused it.
  resume(){
   session.claim();
   if(!doc?.createElement)return claimed;
   if(!element){
    element=doc.createElement('audio');
    element.loop=true;element.playsInline=true;element.preload='auto';element.volume=1;
    element.setAttribute?.('playsinline','');element.setAttribute?.('aria-hidden','true');
    if(element.style)element.style.display='none';
    element.src=uri??=silentWavUri();
    (doc.body??doc.documentElement)?.append?.(element);
   }
   // `paused` is true both before the first play and after an interruption paused us.
   if(element.paused!==false)try{element.play()?.catch?.(()=>{});}catch{/* No media, no trick: the claim above may still be enough. */}
   return true;
  },
  // Muting the game should hand the audio session back, so the player's own music can return.
  release(){
   try{element?.pause?.();}catch{}
   if(nav?.audioSession&&claimed)try{nav.audioSession.type='auto';}catch{}
   claimed=false;
  },
  // Arms the first gesture, and every later one: a session lost to an interruption costs one tap, not a reload.
  listen(target=doc){
   if(listening||!target?.addEventListener)return ()=>{};
   const wake=()=>{session.resume();};
   const visible=()=>{if(!doc?.hidden)session.resume();};
   for(const name of GESTURES)target.addEventListener(name,wake,{capture:true,passive:true});
   doc?.addEventListener?.('visibilitychange',visible);
   listening=()=>{
    for(const name of GESTURES)target.removeEventListener?.(name,wake,{capture:true});
    doc?.removeEventListener?.('visibilitychange',visible);
    listening=null;
   };
   return ()=>listening?.();
  },
  destroy(){listening?.();session.release();element?.remove?.();element=null;},
 };
 return session;
}

export const audioSession=createAudioSession();
