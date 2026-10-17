// Which brief a Sequence run should show, and how many moves it gets.
//
// The shell used to show the v2 brief for every Sequence run, so a v3 run read "Reach 500 points. 25 moves."
// above the v3 objectives it was actually being scored against. The engine already picks its ruleset and its
// own opening message correctly (SequenceEngine in dist/tryout-games.js); this is the same choice, made the
// same way, for the text the shell draws before the engine starts.
//
// Nothing is imported here on purpose: the briefs come from the caller, so this stays a pure function the
// tests can run without the gameplay bundle and without a browser.

// What a run with no ruleset of its own gets, matching the engine's own default.
export const SEQUENCE_LATEST=3;
// v1 and v2 both ran on a fixed 25 moves. v3 sets its own per level.
export const SEQUENCE_V2_MOVES=25;

// A ranked run carries the ruleset its seed was made under, so an old run keeps being judged by the rules it
// was played under. Free play has no run behind it and gets today's rules. Anything the engine would not
// recognise lands on the latest, exactly as the engine lands on it.
export function sequenceRulesVersion(ranked){
  if(!ranked)return SEQUENCE_LATEST;
  const sent=ranked.rulesVersion??1;
  return sent===1?1:sent===2?2:SEQUENCE_LATEST;
}

// One line, never two: a v3 run is told its v3 objective and nothing else.
export function sequenceObjective(version,level,{v2,v3}){
  return version===SEQUENCE_LATEST?v3(level):v2(level);
}

// The move count that belongs to the same ruleset, for the board's description and the opening HUD.
export function sequenceMoves(version,level,{v3Level}){
  return version===SEQUENCE_LATEST?v3Level(level).moves:SEQUENCE_V2_MOVES;
}

// The score the run is aiming at, for the GOAL tile before the engine reports its own.
export function sequenceTargetFor(version,level,{v2Level,v3Level}){
  return version===SEQUENCE_LATEST?v3Level(level).target:v2Level(level).target;
}
