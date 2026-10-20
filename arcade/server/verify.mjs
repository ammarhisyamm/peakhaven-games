// Turns a submitted replay into the score it really earned, by playing it again with the game's own code.
// The client's claimed score is never trusted; it is only kept to flag runs worth a closer look.
import {SIM_STEP} from '../../dist/rng.js';
import {replayRidge,replaySequence,replayBlocks} from '../../tools/replay.mjs';
import {BLOCKS_REPLAY_VERSION} from '../../dist/blocks-core.js';
import {statsFromRun} from '../../dist/achievements.js';

export class RejectedRun extends Error{}
const reject=reason=>{throw new RejectedRun(reason);};
// Game time can't run ahead of the real time since the server handed out the seed (plus slack for latency).
const CLOCK_SLACK_SECONDS=15;
const MAX_REPLAY_BYTES=400_000;
// Peak Blocks has no clock of its own: its log is a list of placements with no tick on them, so unlike
// Ridge and Sequence there is no game time to compare against the real time. Its placements are the clock
// instead — a run cannot have taken less time than its own moves take to make. This is an average over the
// whole run, so a burst of quick placements is fine; what it rules out is sustaining one.
//
// A quarter of a second per placement is a long way below any human. A placement is a drag from the tray
// to a square, or two taps, and the shortest run the game can produce is far longer than a burst: across
// 800 simulated runs over two play styles (greedy, and first-fit-wherever) the fewest placements in a
// finished run was 45, so even the shortest run has to average over 4 placements a second for the whole
// run to fall under this. Tool uses (bomb, undo, shuffle, hint) are deliberately not counted, which only
// makes the floor more generous.
export const MIN_BLOCKS_MOVE_SECONDS=.25;

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
      // Pinned the same way Ridge and Sequence are, so a browser cannot pick its own board rules. It
      // matters: v1 deals trays with no difficulty ramp, which is easier and scores higher on the same
      // seed, and replayBlocks will happily verify v1, v2 or v3.
      //
      // Unlike the other two, the Blocks seed carries no version marker, so there is nothing to read an
      // in-flight run's rules back off: the one version in play is the one the client ships, and a run
      // that was in flight when this deployed is refused rather than scored under rules it did not play
      // on. That is also why this reads BLOCKS_REPLAY_VERSION rather than the caller's `rulesVersion` —
      // for Sequence an absent `rulesVersion` means "any", and a Blocks version that could be unpinned by
      // a caller forgetting to pass one is the hole this is closing.
      if(replay.v!==BLOCKS_REPLAY_VERSION)reject('Replay uses different board rules');
      const r=replayBlocks(replay);
      result={score:r.score,ended:true,ticks:0,won:false,detail:{lines:r.lines,moves:r.moves},
        stats:{score:r.score,bestCombo:r.bestCombo,lines:r.lines},
        minSeconds:Math.max(0,Number(r.moves)||0)*MIN_BLOCKS_MOVE_SECONDS};
    }
    else reject('Game is not part of the competition');
  }catch(error){
    if(error instanceof RejectedRun)throw error;
    reject(`Replay failed: ${String(error?.message||error).slice(0,120)}`);
  }
  if(result.unusedInputs)reject('Replay contains unused or invalid inputs');
  const gameSeconds=(result.ticks||0)*SIM_STEP;
  if(Number.isFinite(elapsedSeconds)&&gameSeconds>elapsedSeconds+CLOCK_SLACK_SECONDS)reject('Run finished faster than real time allows');
  // The same test from the other side, for a game whose replay has no clock in it. Both say the same thing
  // — the run came in faster than it could have been played — so they report it the same way.
  if(Number.isFinite(elapsedSeconds)&&elapsedSeconds<(result.minSeconds??0))reject('Run finished faster than real time allows');
  if(!Number.isInteger(result.score)||result.score<0)reject('Replay produced an invalid score');
  // The achievement numbers, worked out from the replay that was just played here and nowhere else. A
  // browser can claim any score and any combo; it cannot make this replay produce them.
  return {score:result.score,won:Boolean(result.won),gameSeconds,detail:result.detail??null,
    stats:statsFromRun(game,result.stats??{})};
}
