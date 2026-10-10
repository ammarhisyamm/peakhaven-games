const rounds=[['tower','Find your balance',3,20],['sort','A little order',1,25],['merge','Make a match',3,30],['tower','Steady hands',5,30],['sort','Colour flow',2,35],['merge','Mix it up',5,40]];
export const CHAPTERS=['The mountain lab','Find your flow','Reach new heights'];
export const MISSIONS=CHAPTERS.flatMap((chapter,c)=>rounds.map(([game,title,target,xp],i)=>({id:c*6+i,chapter:c,game,title,target:game==='sort'?target+c*2:target+c*2,xp:xp+c*10})));
export const objective=m=>m.game==='tower'?`Stack ${m.target} vials`:m.game==='merge'?`Make ${m.target} merges`:`Solve level ${m.target}`;
export function progress(m,result){return m.game==='tower'?result.height||0:m.game==='merge'?result.merges||0:result.won?m.target:0;}
export function award(completed,xp,mission,result){if(progress(mission,result)<mission.target)return {completed:[...completed],xp,gained:0,won:false};const replay=completed.includes(mission.id),gained=replay?5:mission.xp;return {completed:replay?[...completed]:[...completed,mission.id],xp:xp+gained,gained,won:true};}
export function unlocked(completed,id){return id===0||completed.includes(id-1);}
