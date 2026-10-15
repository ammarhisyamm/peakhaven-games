// Competition rules shared by the API and its tests. Everything here is pure: no network, no database.
import {createHmac} from 'node:crypto';

export const COMPETITION=Object.freeze({
  // Calendar days and months follow Melbourne time, so "today" and "this month" match the prize rules.
  timeZone:'Australia/Melbourne',
  triesPerDay:3,
  games:['blocks','sequence','ridge'],
  // Rank points per game per month: 1st place 100, 2nd 90 and so on; anyone else who scored gets 1.
  points:[100,90,80,70,60,50,45,40,35,30,25,20,15,10,5],
  minPoints:1,
});

const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:COMPETITION.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
// YYYY-MM-DD in Melbourne for the given instant.
export function dayKey(date=new Date()){return dayFormat.format(date);}
export const monthKey=(date=new Date())=>dayKey(date).slice(0,7);
export const yearKey=(date=new Date())=>dayKey(date).slice(0,4);
export function monthRange(month){return {from:`${month}-01`,to:`${month}-31`};}
export function yearRange(year){return {from:`${year}-01-01`,to:`${year}-12-31`};}

// Everyone gets the same course in a game on a given day (and the same board for each Sequence level), which keeps
// the contest about skill. The seed is derived from a server secret so nobody can see tomorrow's course in advance.
export function seedFor(secret,game,day,level=1){
  if(!secret)throw new Error('RUN_SEED_SECRET is not set');
  return createHmac('sha256',secret).update(`${game}:${day}:${level}`).digest().readUInt32BE(0);
}

export function cleanName(value){
  const name=String(value??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,24);
  return name.length>=2?name:null;
}
export function cleanEmail(value){
  const email=String(value??'').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254?email:null;
}
export const cleanCode=value=>String(value??'').trim().toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,32)||null;

export function pointsForRank(rank){return COMPETITION.points[rank-1]??COMPETITION.minPoints;}

// Each player's best score in one game, ranked. `runs` are scored runs ({player_id, game, score, updated_at}).
function gameTable(runs,game){
  const best=new Map();
  for(const r of runs){
    if(r.game!==game||!(r.score>0))continue;
    const prev=best.get(r.player_id),at=Date.parse(r.updated_at)||0;
    if(!prev||r.score>prev.score||(r.score===prev.score&&at<prev.at))best.set(r.player_id,{score:r.score,at});
  }
  const sorted=[...best].sort((a,b)=>b[1].score-a[1].score||a[1].at-b[1].at);
  const table=new Map();let rank=0,last=null;
  sorted.forEach(([player,b],i)=>{if(b.score!==last){rank=i+1;last=b.score;}table.set(player,{best:b.score,rank,points:pointsForRank(rank),at:b.at});});
  return table;
}

// One game's board for a month or a year: each player's best score in that game, highest first. Equal scores
// share a rank, and the earlier one is listed first.
export function gameStandings(runs,game){
  return [...gameTable(runs,game)].sort((a,b)=>a[1].rank-b[1].rank||a[1].at-b[1].at)
    .map(([player_id,e])=>({player_id,points:e.best,best:e.best,rank:e.rank}));
}

// One month's overall table, which decides the prizes. Each player's best score per game is ranked (equal scores
// share a rank, the earlier one listed first) and earns rank points; the three games add up.
export function monthlyStandings(runs){
  const perGame={};
  for(const game of COMPETITION.games)perGame[game]=gameTable(runs,game);
  const players=new Set(COMPETITION.games.flatMap(g=>[...perGame[g].keys()]));
  const rows=[...players].map(player=>{
    const games={};let points=0,rankSum=0,reachedAt=0;
    for(const g of COMPETITION.games){const e=perGame[g].get(player);if(e){games[g]={best:e.best,rank:e.rank,points:e.points};points+=e.points;rankSum+=e.rank;reachedAt=Math.max(reachedAt,e.at);}else rankSum+=1e6;}
    return {player_id:player,points,games,rankSum,reachedAt};
  });
  return rank(rows);
}

// The year's table adds up each month's rank points.
export function yearlyStandings(runs){
  const byMonth=new Map();
  for(const r of runs){const m=String(r.day).slice(0,7);if(!byMonth.has(m))byMonth.set(m,[]);byMonth.get(m).push(r);}
  const totals=new Map();
  for(const monthRuns of byMonth.values())for(const row of monthlyStandings(monthRuns)){
    const t=totals.get(row.player_id)??{player_id:row.player_id,points:0,wins:0,rankSum:0,reachedAt:0,games:{}};
    t.points+=row.points;if(row.rank===1)t.wins++;t.reachedAt=Math.max(t.reachedAt,row.reachedAt);
    totals.set(row.player_id,t);
  }
  return rank([...totals.values()].map(t=>({...t,rankSum:-t.wins})));
}

// Ties on points go to the player with better game ranks, then to whoever got there first, so there is always one winner.
function rank(rows){
  rows.sort((a,b)=>b.points-a.points||a.rankSum-b.rankSum||a.reachedAt-b.reachedAt||String(a.player_id).localeCompare(String(b.player_id)));
  return rows.map((r,i)=>{const {rankSum,reachedAt,...rest}=r;return {...rest,rank:i+1};});
}

// Months (YYYY-MM) in which the player finished in the overall top three. `runs` should cover finished months only.
export function podiumMonths(runs,playerId){
  const byMonth=new Map();
  for(const r of runs){const m=String(r.day).slice(0,7);if(!byMonth.has(m))byMonth.set(m,[]);byMonth.get(m).push(r);}
  return [...byMonth].filter(([,monthRuns])=>monthlyStandings(monthRuns).some(r=>r.player_id===playerId&&r.rank<=3)).map(([m])=>m).sort();
}
