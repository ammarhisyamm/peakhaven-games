// A failed score submission survives a reload in this tab. Replays contain inputs, never auth tokens.
export function pendingResultStore(storage){
 const key='ph-arcade-pending-result';let memory=null;
 try{storage??=globalThis.sessionStorage;memory=JSON.parse(storage.getItem(key)||'null');}catch{}
 if(!memory||typeof memory.owner!=='string'||!['blocks','sequence','ridge'].includes(memory.game)||typeof memory.body?.runId!=='string'||!memory.body.replay)memory=null;
 return {
  get(owner){return owner&&memory?.owner===owner?memory:null;},
  set(owner,game,body){memory={owner,game,body};try{storage.setItem(key,JSON.stringify(memory));}catch{}},
  clear(owner){if(owner&&memory?.owner!==owner)return;memory=null;try{storage.removeItem(key);}catch{}},
 };
}
