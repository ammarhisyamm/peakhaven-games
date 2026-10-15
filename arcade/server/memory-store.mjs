// In-memory stand-ins for Supabase, used by the tests and the local preview server. Same calls as supabase-store.mjs.
import {randomUUID} from 'node:crypto';

export function createMemoryStore({invites={},now=()=>new Date()}={}){
  const codes=new Map(Object.entries(invites).map(([code,max])=>[code,{max,uses:0}]));
  const players=new Map(),runs=new Map();
  const copy=v=>v&&structuredClone(v);
  return {
    codes,players,runs,
    async inviteAvailable(code){const c=codes.get(code);return Boolean(c&&c.uses<c.max);},
    async useInvite(code){const c=codes.get(code);if(!c||c.uses>=c.max)return false;c.uses++;return true;},
    async createPlayer(p){players.set(p.id,{...p,created_at:now().toISOString()});return copy(players.get(p.id));},
    async getPlayer(id){return copy(players.get(id))??null;},
    async updatePlayer(id,patch){Object.assign(players.get(id),patch);return copy(players.get(id));},
    async playersByIds(ids){return ids.map(id=>players.get(id)).filter(Boolean).map(copy);},
    async countRuns(playerId,day){const out={};for(const r of runs.values())if(r.player_id===playerId&&r.day===day)out[r.game]=(out[r.game]||0)+1;return out;},
    async startRun({playerId,game,day,seed,limit}){
      const used=[...runs.values()].filter(r=>r.player_id===playerId&&r.game===game&&r.day===day).length;
      if(used>=limit)return null;
      const t=now().toISOString();
      for(const r of runs.values())if(r.player_id===playerId&&r.game===game&&r.status==='open'){r.status='closed';r.finished_at=t;}
      const run={id:randomUUID(),player_id:playerId,game,day,seed,level:1,segments:0,score:0,status:'open',flagged:false,replays:[],started_at:t,updated_at:t,finished_at:null,reject_reason:null};
      runs.set(run.id,run);return copy(run);
    },
    async getRun(id){return copy(runs.get(id))??null;},
    async updateRunIf(id,segments,patch){const r=runs.get(id);if(!r||r.segments!==segments||r.status!=='open')return null;Object.assign(r,patch);return copy(r);},
    async finishedScores(playerId){return [...runs.values()].filter(r=>r.player_id===playerId&&r.status==='closed').map(r=>r.score);},
    async scoredRuns(from,to){return [...runs.values()].filter(r=>r.status!=='rejected'&&r.score>0&&r.day>=from&&r.day<=to).map(({id,player_id,game,score,day,updated_at})=>({id,player_id,game,score,day,updated_at}));},
  };
}

export function createMemoryAuth(){
  const users=new Map(),tokens=new Map(),sent=[];
  return {
    users,sent,
    tokenFor(email){const u=[...users.values()].find(u=>u.email===email);if(!u)return null;const t=`token-${u.id}`;tokens.set(t,u);return t;},
    async userFromToken(token){return tokens.get(token)??null;},
    async createUser(email){const existing=[...users.values()].find(u=>u.email===email);if(existing)return {exists:true,id:existing.id};const u={id:randomUUID(),email};users.set(u.id,u);return {id:u.id};},
    async deleteUser(id){users.delete(id);},
    async sendLink(email,redirectTo){sent.push({email,redirectTo});},
  };
}
