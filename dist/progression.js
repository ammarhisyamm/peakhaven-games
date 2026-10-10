// Keep the original 18 IDs and rewards stable for existing device saves.
const rounds=[['tower','Find your balance',3,20],['sort','A little order',1,25],['merge','Make a match',3,30],['tower','Steady hands',5,30],['sort','Colour flow',2,35],['merge','Mix it up',5,40]];
export const CHAPTERS=['The mountain lab','Find your flow','Reach new heights'];
export const MISSIONS=CHAPTERS.flatMap((chapter,c)=>rounds.map(([game,title,target,xp],i)=>({id:c*6+i,chapter:c,game,title,target:target+c*2,xp:xp+c*10,level:game==='sort'?target+c*2:c*2+(i>2?2:1)})));
const rotation=['tower','sort','merge','blocks','mahjong','tower'];
const names={tower:'Higher horizons',sort:'Colour currents',merge:'Chain reaction',blocks:'Crystal cascade',mahjong:'Moonlit matches'};
export function gameChallenge(game,level=1){level=Math.max(1,Math.floor(level));const rise=Math.floor(Math.sqrt(level-1)*1.6);return {game,level,target:game==='tower'||game==='merge'?3+rise:game==='blocks'?2+rise:game==='mahjong'?17+(level>=4?3:0)+(level>=8?3:0)+(level>=15?1:0):level};}
export function missionAt(id){if(!Number.isSafeInteger(id)||id<0)return null;if(id<MISSIONS.length)return MISSIONS[id];const chapter=Math.floor(id/6),game=rotation[(id-18)%6],level=chapter*2+((id%6)>2?2:1);return {...gameChallenge(game,level),id,chapter,title:names[game],xp:Math.min(150,40+chapter*5)};}
export const chapterMissions=chapter=>Array.from({length:6},(_,i)=>missionAt(chapter*6+i));
export const chapterName=chapter=>CHAPTERS[chapter]||['Crystal heights','The tidal lab','Moonlit summit'][(chapter-3)%3];
export function firstIncomplete(completed){const set=new Set(completed);let id=0;while(set.has(id))id++;return id;}
export const objective=m=>m.game==='tower'?`Stack ${m.target} vials`:m.game==='merge'?`Make ${m.target} merges`:m.game==='blocks'?`Clear ${m.target} lines`:m.game==='mahjong'?`Match all ${m.target} pairs`:`Solve level ${m.target}`;
export function progress(m,result){return m.game==='tower'?result.height||0:m.game==='merge'?result.merges||0:m.game==='blocks'?result.lines||0:result.won?m.target:0;}
export function award(completed,xp,mission,result){if(progress(mission,result)<mission.target)return {completed:[...completed],xp,gained:0,won:false};const replay=completed.includes(mission.id),gained=replay?5:mission.xp;return {completed:replay?[...completed]:[...completed,mission.id],xp:xp+gained,gained,won:true};}
export function unlocked(completed,id){return Number.isSafeInteger(id)&&id>=0&&(id===0||completed.includes(id-1));}
