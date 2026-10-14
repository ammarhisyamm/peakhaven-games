// Guest is an on-device prototype session, never a competition account or token.
export function withGuestMode(account,storage){
 const key='ph-arcade-guest-session';
 let guest=false;
 try{storage??=globalThis.sessionStorage;guest=storage.getItem(key)==='1'&&!account.signedIn?.();if(account.signedIn?.())storage.removeItem(key);}catch{}
 const listeners=new Set();
 const notify=()=>listeners.forEach(fn=>fn());
 const setGuest=value=>{guest=value;try{value?storage.setItem(key,'1'):storage.removeItem(key);}catch{}};
 account.onChange?.(()=>{if(account.signedIn?.())setGuest(false);notify();});
 return {
  ...account,
  get enabled(){return Boolean(account.enabled)&&!guest;},
  isGuest:()=>guest,
  signedIn:()=>!guest&&Boolean(account.signedIn?.()),
  continueAsGuest(){setGuest(true);notify();},
  leaveGuest(){setGuest(false);notify();},
  api(...args){return guest?Promise.resolve({ok:false,status:0,error:'Guest progress stays on this device.'}):account.api(...args);},
  async signOut(){if(guest){setGuest(false);notify();}else await account.signOut();},
  onChange:fn=>listeners.add(fn),
 };
}
