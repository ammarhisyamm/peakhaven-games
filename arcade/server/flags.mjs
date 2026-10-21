// Why a run is worth a second look, worked out from what the server itself measured.
//
// A flag never rejects a run, never changes its score and never moves it on a board. All it does is put the
// run in "Runs to review" with a sentence saying what looked odd, for a person to judge. That is the whole
// contract, and it is why the thresholds below can afford to be generous: a false positive costs somebody
// ten seconds of reading, where a false rejection would cost a player their run.
//
// Everything here is pure. The numbers come from the replay the server just played and from its own
// timestamps, never from anything the browser said about itself — except the claimed score, which is only
// ever compared against the verified one.
import {SIM_STEP} from '../../dist/rng.js';

// How long one segment may take before it is worth remarking on. A segment is one Sequence level, or the
// whole of a Blocks or Ridge run, and its clock starts where the last one stopped: the run's own start for
// the first, the previous segment's finish for the rest.
//
// Per segment rather than per run, because a run is handed its seed a segment at a time. What is worth
// reading is a long stretch holding one seed with nothing submitted for it, not a long sitting: a Sequence
// player clearing thirty levels at a human pace crosses half an hour without anything odd happening, and a
// whole-run clock flags every one of them.
export const LONG_SEGMENT_SECONDS=30*60;
// A score this many times the player's own previous best, once they have enough history for "best" to mean
// something, is worth a look. Someone genuinely improving does not usually treble their best in one run.
export const OUTLIER_MULTIPLE=3;
export const OUTLIER_MIN_RUNS=5;
// Sequence logs the tick of every move, so the gap between moves is known exactly. A median under this is
// faster than a hand moves, sustained.
export const FAST_SEQUENCE_GAP_SECONDS=.15;
// Peak Blocks logs no tick at all, so the only clock it has is the run's own wall time over its placements.
// Below 250ms a run is refused outright (see MIN_BLOCKS_MOVE_SECONDS in verify.mjs); this is the band above
// that which is still quicker than a person placing pieces.
export const FAST_BLOCKS_MOVE_SECONDS=.4;
// Below this many inputs a median says nothing, so no timing flag is raised at all.
export const MIN_INPUTS_FOR_TIMING=8;

const round=(n,places=0)=>{const f=10**places;return Math.round(n*f)/f;};
const number=n=>Math.round(n).toLocaleString('en-AU');

// "2 h 14 min", "47 min", "38 s" — the shortest form that still says the thing.
export function formatDuration(seconds){
  const s=Math.max(0,Math.round(Number(seconds)||0));
  if(s<60)return `${s} s`;
  const minutes=Math.round(s/60);
  if(minutes<60)return `${minutes} min`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return rest?`${hours} h ${rest} min`:`${hours} h`;
}
// Milliseconds, as a person would say them: "118 ms", "1.4 s".
export const formatGap=seconds=>seconds<1?`${Math.round(seconds*1000)} ms`:`${round(seconds,1)} s`;

// The median gap between inputs, in seconds, from a list of tick numbers. Null when there are too few
// inputs for a median to mean anything — which is the difference between "this looks like a bot" and
// "there was not enough here to tell", and those must not be confused.
export function medianGapSeconds(ticks){
  if(!Array.isArray(ticks)||ticks.length<MIN_INPUTS_FOR_TIMING)return null;
  const gaps=[];
  for(let i=1;i<ticks.length;i++){
    const gap=Number(ticks[i])-Number(ticks[i-1]);
    if(!Number.isFinite(gap)||gap<0)return null;
    gaps.push(gap*SIM_STEP);
  }
  if(!gaps.length)return null;
  gaps.sort((a,b)=>a-b);
  const middle=gaps.length>>1;
  return gaps.length%2?gaps[middle]:(gaps[middle-1]+gaps[middle])/2;
}

// The best of a player's earlier verified runs in this game, and how many there were. Both are needed: a
// treble of a best that rests on two runs is not a signal, it is a player getting started.
export function historyOf(scores){
  const list=(scores??[]).map(n=>Number(n)||0).filter(n=>Number.isFinite(n));
  return {runs:list.length,best:list.reduce((m,n)=>Math.max(m,n),0)};
}

// Every reason this run is worth reviewing, as {code, text} plus whatever numbers the sentence was built
// from. The text is what an admin reads; the code is what a later query can count.
//
// Nothing in here can refuse a run or alter a score. It is handed only measurements:
//   claimed / verified      the browser's number against the one the replay produced
//   segmentSeconds          how long this segment alone took, by the server's clock
//   segment                 which one it was: the Sequence level, or 1 for a single-segment game
//   history                 the player's earlier verified scores in this game
//   moves                   inputs in this segment, from the replay
//   medianGapSeconds        median gap between them, where the replay carries a clock
//   wallSecondsPerMove      the run's own wall time over its placements (Peak Blocks only)
export function runFlags({game,claimed,verified,segmentSeconds,segment,history,moves,medianGapSeconds,wallSecondsPerMove}){
  const out=[];
  if(Number.isFinite(claimed)&&claimed!==verified)
    out.push({code:'claim-mismatch',claimed,verified,
      text:`Claimed ${number(claimed)} against a verified ${number(verified)}.`});
  // Measured when the segment lands, so there is no "is the run over yet" to wait for: a segment that took
  // this long is finished by the time it is being read, whether or not the run goes on. Only Sequence has
  // more than one, so only Sequence names a level; anywhere else the segment is the run.
  if(Number.isFinite(segmentSeconds)&&segmentSeconds>LONG_SEGMENT_SECONDS)
    out.push({code:'long-open',segmentSeconds:round(segmentSeconds),segment:Number(segment)||1,
      text:game==='sequence'
        ?`Level ${Number(segment)||1} took ${formatDuration(segmentSeconds)}.`
        :`This run took ${formatDuration(segmentSeconds)}.`});
  const past=history?historyOf(history):null;
  if(past&&past.runs>=OUTLIER_MIN_RUNS&&past.best>0&&verified>past.best*OUTLIER_MULTIPLE)
    out.push({code:'score-outlier',score:verified,previousBest:past.best,priorRuns:past.runs,
      text:`Scored ${number(verified)}, more than ${OUTLIER_MULTIPLE}x their previous best of ${number(past.best)} over ${past.runs} earlier runs.`});
  if(game==='sequence'&&Number.isFinite(medianGapSeconds)&&Number(moves)>=MIN_INPUTS_FOR_TIMING
     &&medianGapSeconds<FAST_SEQUENCE_GAP_SECONDS)
    out.push({code:'fast-moves',medianGapSeconds:round(medianGapSeconds,3),moves:Number(moves),
      text:`Moves ${formatGap(medianGapSeconds)} apart on average, over ${number(moves)} moves.`});
  if(game==='blocks'&&Number.isFinite(wallSecondsPerMove)&&Number(moves)>=MIN_INPUTS_FOR_TIMING
     &&wallSecondsPerMove<FAST_BLOCKS_MOVE_SECONDS)
    out.push({code:'fast-moves',wallSecondsPerMove:round(wallSecondsPerMove,3),moves:Number(moves),
      text:`${formatGap(wallSecondsPerMove)} a placement over ${number(moves)} placements.`});
  return out;
}

// A Sequence run is verified a level at a time, so its reasons arrive in instalments. One code is kept once:
// the newest wins, because it was measured over more of the run. Order is kept so the page reads the way the
// run happened.
//
// long-open is the exception, because it is the one reason measured over a single segment rather than over
// everything so far: the longest stretch stays. Otherwise a 90-minute level three would be quietly replaced
// by a 35-minute level seven, and the worse of the two is the one worth reading.
const keep=(existing,incoming)=>
  existing.code==='long-open'&&(Number(existing.segmentSeconds)||0)>(Number(incoming.segmentSeconds)||0)
    ?existing:incoming;
export function mergeReasons(existing,incoming){
  const out=[];
  const fresh=new Map((incoming??[]).map(r=>[r.code,r]));
  for(const reason of existing??[]){
    if(!reason||typeof reason!=='object'||!reason.code)continue;
    out.push(fresh.has(reason.code)?keep(reason,fresh.get(reason.code)):reason);
    fresh.delete(reason.code);
  }
  for(const reason of incoming??[])if(fresh.has(reason.code)){out.push(reason);fresh.delete(reason.code);}
  return out;
}

// A stored run described from its replays alone, for the admin page to show beside a winner: how many
// inputs it took and how long it lasted in game time. Read straight off the log rather than replayed, so
// looking at a podium costs nothing — re-playing it is what the Re-verify button is for.
//
// Peak Blocks has no clock in its log, so its game time is null and the wall clock is all there is. Said
// plainly rather than reported as zero, because "no clock" and "no time" are different facts.
export function summariseReplays(game,replays){
  const list=Array.isArray(replays)?replays:[];
  let moves=0,ticks=0,clocked=false;
  for(const replay of list){
    if(!replay||typeof replay!=='object')continue;
    if(game==='ridge')moves+=Array.isArray(replay.taps)?replay.taps.length:0;
    else if(game==='sequence')moves+=Array.isArray(replay.moves)?replay.moves.length:0;
    else moves+=Array.isArray(replay.log)?replay.log.length:0;
    if(Number.isFinite(replay.endTick)){ticks+=replay.endTick;clocked=true;}
  }
  return {segments:list.length,moves,gameSeconds:clocked?round(ticks*SIM_STEP,1):null};
}

// What the admin page says when a run is flagged but the migration that keeps the reasons has not run yet.
// It is the sentence the page showed before there was anywhere to put a reason.
export const LEGACY_FLAG_REASON='The score sent did not match its replay.';
