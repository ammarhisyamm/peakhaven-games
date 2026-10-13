// Sequence balance check: bot win rate by level, old target (350 + 150 * level) against the current one.
//   node tools/sequence-balance.mjs [--seeds 40] [--levels 60] [--every 1] [--bot greedy|lookahead|plain]
// A level's run doesn't depend on the target until it is reached, so each seed is played once with no
// target and checked against both: win(T) = score >= T.
import {sequenceTarget,sequencePalette} from '../dist/sequence-rules.js';
import {playSequence,greedyMove,lookaheadMove,plainMove} from './sequence-bot.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const seeds=+arg('seeds',40),levels=+arg('levels',60),every=+arg('every',1),bot=arg('bot','greedy');
const pick={greedy:greedyMove,lookahead:lookaheadMove,plain:plainMove}[bot];
if(!pick)throw new Error(`Unknown bot ${bot}`);
const oldTarget=level=>350+Math.max(1,level)*150;
const pct=(n)=>`${Math.round(100*n/seeds)}%`.padStart(5);

console.log(`Sequence balance: ${bot} bot, ${seeds} seeds per level`);
// With --every n, the "band" columns pool every level since the previous row, which steadies the numbers.
console.log('level colours  old target  old win  band old  new target  new win  band new  median score');
let band={old:0,new:0,n:0};
for(let level=1;level<=levels;level++){
  const scores=[];
  for(let s=0;s<seeds;s++)scores.push(playSequence({level,seed:(level*7919+s*104729)>>>0,pick,target:Infinity}).score);
  const wins=t=>scores.filter(x=>x>=t).length;scores.sort((a,b)=>a-b);
  band.old+=wins(oldTarget(level));band.new+=wins(sequenceTarget(level));band.n+=seeds;
  if(level!==1&&level%every)continue;
  const bp=w=>`${Math.round(100*w/band.n)}%`.padStart(8);
  console.log(`${String(level).padStart(5)} ${String(sequencePalette(level)).padStart(7)}  ${String(oldTarget(level)).padStart(10)}  ${pct(wins(oldTarget(level))).padStart(7)}  ${bp(band.old)}  ${String(sequenceTarget(level)).padStart(10)}  ${pct(wins(sequenceTarget(level))).padStart(7)}  ${bp(band.new)}  ${String(scores[seeds>>1]).padStart(12)}`);
  band={old:0,new:0,n:0};
}
