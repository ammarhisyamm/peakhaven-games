// Reuse the same request ID after an uncertain start response, including a reload in the same tab.
export function startRequestStore(storage){
 const key='ph-arcade-start-request';let pending=null;
 try{storage??=globalThis.sessionStorage;pending=JSON.parse(storage.getItem(key)||'null');}catch{}
 return {
  id(owner,game){if(!pending||pending.owner!==owner||pending.game!==game||typeof pending.id!=='string')pending={owner,game,id:crypto.randomUUID()};try{storage.setItem(key,JSON.stringify(pending));}catch{}return pending.id;},
  clear(){pending=null;try{storage.removeItem(key);}catch{}},
 };
}
