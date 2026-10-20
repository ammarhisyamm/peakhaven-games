// Turns a submitted replay into the score it really earned, by playing it again with the game's own code.
// The client's claimed score is never trusted; it is only kept to flag runs worth a closer look.
import {SIM_STEP} from '../../dist/rng.js';
import {replayRidge,replaySequence,replayBlocks} from '../../tools/replay.mjs';
import {statsFromRun} from '../../dist/achievements.js';

export class RejectedRun extends Error{}
const reject=reason=>{throw new RejectedRun(reason);};
// Game time can't run ahead of the real time since the server handed out the seed (plus slack for latency).
const CLOCK_SLACK_SECONDS=15;
const MAX_REPLAY_BYTES=400_000;

export async function verifySegment({game,replay,seed,level,elapsedSeconds,rulesVersion}){
  if(!replay||typeof replay!=='object')reject('Missing replay');
  if(JSON.stringify(replay).length>MAX_REPLAY_BYTES)reject('Replay too large');
  if(replay.game!==game)reject('Replay is for another game');
  if((replay.seed>>>0)!==(seed>>>0)||replay.seed!==seed)reject('Replay used a different course');
  let result;
  try{
    if(game==='ridge'){
      if(rulesVersion===6&&replay.v!==6)reject('Replay uses different course rules');
      if(rulesVersion===5&&![4,5].includes(replay.v))reject('Replay uses different course rules');
      result=await replayRidge(replay);
    }
    else if(game==='sequence'){
      if(replay.level!==level)reject('Replay is for another level');
      if(rulesVersion!==undefined&&replay.v!==rulesVersion)reject('Replay uses different level rules');
      result=await replaySequence(replay);
    }
    else if(game==='blocks'){
      const r=replayBlocks(replay);
      result={score:r.score,ended:true,ticks:0,won:false,detail:{lines:r.lines,moves:r.moves},
        stats:{score:r.score,bestCombo:r.bestCombo,lines:r.lines}};
    }
    else reject('Game is not part of the competition');
  }catch(error){
    if(error instanceof RejectedRun)throw error;
    reject(`Replay failed: ${String(error?.message||error).slice(0,120)}`);
  }
  if(result.unusedInputs)reject('Replay contains unused or invalid inputs');
  const gameSeconds=(result.ticks||0)*SIM_STEP;
  if(Number.isFinite(elapsedSeconds)&&gameSeconds>elapsedSeconds+CLOCK_SLACK_SECONDS)reject('Run finished faster than real time allows');
  if(!Number.isInteger(result.score)||result.score<0)reject('Replay produced an invalid score');
  // The achievement numbers, worked out from the replay that was just played here and nowhere else. A
  // browser can claim any score and any combo; it cannot make this replay produce them.
  return {score:result.score,won:Boolean(result.won),gameSeconds,detail:result.detail??null,
    stats:statsFromRun(game,result.stats??{})};
}
