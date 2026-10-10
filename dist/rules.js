export const COLORS = ['#08bffc','#fa35b6','#ffd325','#a63eff','#20cf7d','#3572ff'];
export const COLOR_NAMES = ['Cyan','Pink','Gold','Purple','Green','Blue'];
export const CAPACITY = 4;
export function canPour(tubes, from, to) {
  const a=tubes[from], b=tubes[to];
  return from!==to && a.length>0 && b.length<CAPACITY && (!b.length || a.at(-1)===b.at(-1));
}
export function pour(tubes, from, to) {
  if(!canPour(tubes,from,to)) return null;
  const next=tubes.map(t=>[...t]), a=next[from], b=next[to], color=a.at(-1);
  while(a.length && a.at(-1)===color && b.length<CAPACITY) b.push(a.pop());
  return next;
}
export function isSolved(tubes) {
  return tubes.every(t=>!t.length || (t.length===CAPACITY && t.every(c=>c===t[0])));
}
export function createPuzzle(level=1,random=Math.random) {
  if(level===1) return [[0,1,0,1],[1,0,1,0],[],[]];
  const count=Math.min(6,2+Math.floor(level/2));
  let tubes=Array.from({length:count},(_,c)=>[c,c,c,c]).concat([[],[]]);
  let last=[];
  // Reverse legal pours from a solved board: removing a partial top run
  // leaves a matching source, and destination differs, so every step is reversible.
  for(let k=0;k<Math.min(300,150+level*10);k++) {
    const candidates=[];
    for(let a=0;a<tubes.length;a++) {
      const t=tubes[a];if(!t.length)continue;
      let run=1;while(run<t.length&&t[t.length-1-run]===t.at(-1))run++;
      for(let b=0;b<tubes.length;b++) {
        if(a===b || tubes[b].length===4 || tubes[b].at(-1)===t.at(-1) || (last[0]===b&&last[1]===a))continue;
        const max=Math.min(4-tubes[b].length,run===t.length?run:run-1);
        for(let n=1;n<=max;n++)candidates.push([a,b,n]);
      }
    }
    if(!candidates.length)break;
    const [a,b,n]=candidates[Math.floor(random()*candidates.length)];
    tubes[b].push(...tubes[a].splice(-n));last=[a,b];
  }
  if(isSolved(tubes))return createPuzzle(level,random);
  return tubes;
}
export function findHint(tubes,limit=45000) {
  if(isSolved(tubes))return null;
  const key=t=>t.map(x=>x.join('')).sort().join('|');
  const queue=[{t:tubes,first:null}], seen=new Set([key(tubes)]);
  for(let index=0;index<queue.length&&index<limit;index++) {
    const {t,first}=queue[index];
    for(let a=0;a<t.length;a++)for(let b=0;b<t.length;b++) {
      if(!canPour(t,a,b))continue;
      if(!t[b].length && t[a].every(c=>c===t[a][0]))continue;
      const next=pour(t,a,b), k=key(next);if(seen.has(k))continue;
      const move=first||[a,b];if(isSolved(next))return move;
      seen.add(k);queue.push({t:next,first:move});
    }
  }
  return null;
}
export function towerPlacement(previous, x, width=64) {
  const distance=Math.abs(previous-x);
  return {safe:distance<width*.67,perfect:distance<9,offset:distance};
}
export const MERGE_RADII=[34,42,51,61,73,86];
export function mergePair(a,b) {
  if(a.tier!==b.tier||a.tier>=5)return null;
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,vx:(a.vx+b.vx)/2,vy:Math.min(0,(a.vy+b.vy)/2),tier:a.tier+1,r:MERGE_RADII[a.tier+1],age:0};
}
