// Every API request settles: slow/offline networks and non-JSON proxy errors must leave a usable UI.
export async function requestJSON(url,options={},timeout=15000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(url,{...options,signal:controller.signal});
  let data;try{data=await response.json();}catch{return {ok:false,status:response.status,retryable:true,error:'The server returned an unreadable response. Please try again.'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {ok:false,status:response.status,retryable:true,error:'The server returned an unreadable response. Please try again.'};
  return {...data,ok:response.ok,status:response.status,retryable:!response.ok&&(response.status>=500||[408,425,429].includes(response.status)),...(!response.ok?{error:data.error||'Something went wrong. Please try again.'}:{})};
 }catch{return {ok:false,status:0,retryable:true,error:controller.signal.aborted?'The request took too long. Please try again.':'You seem to be offline. Check your connection and try again.'};}
 finally{clearTimeout(timer);}
}
