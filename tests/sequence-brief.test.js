// The line a Sequence run is given before it starts.
//
// The shell used to show the v2 brief for every Sequence run, so a v3 run read "Reach 500 points. 25 moves."
// above the v3 objectives it was actually being scored against. These check that the ruleset the run is played
// under is the one that writes its brief, its move count and its opening goal.
import test from 'node:test';
import assert from 'node:assert/strict';
const {SEQUENCE_LATEST,SEQUENCE_V2_MOVES,sequenceRulesVersion,sequenceObjective,sequenceMoves,sequenceTargetFor}
  =await import('../arcade/ui/game/sequence-objective.js');
const {sequenceBrief,sequenceLevel}=await import('../dist/sequence-progression.js');
const {v3Brief,v3Level}=await import('../dist/sequence-v3.js');

const BRIEFS={v2:sequenceBrief,v3:v3Brief};
const LEVELS={v2Level:sequenceLevel,v3Level};

test('A run is judged by the ruleset it was made under, and free play by the newest',()=>{
  assert.equal(sequenceRulesVersion(null),SEQUENCE_LATEST,'free play gets today\'s rules');
  assert.equal(sequenceRulesVersion(undefined),SEQUENCE_LATEST);
  // A ranked run with no version of its own is from before versions were recorded, which is v1.
  assert.equal(sequenceRulesVersion({runId:'r'}),1);
  assert.equal(sequenceRulesVersion({rulesVersion:1}),1);
  assert.equal(sequenceRulesVersion({rulesVersion:2}),2);
  assert.equal(sequenceRulesVersion({rulesVersion:3}),3);
  // Anything the engine would not recognise lands on the newest, exactly as the engine lands on it.
  assert.equal(sequenceRulesVersion({rulesVersion:99}),SEQUENCE_LATEST);
});

test('A v3 run is shown the v3 line and nothing else',()=>{
  for(const level of [1,4,12,40]){
    const shown=sequenceObjective(3,level,BRIEFS);
    assert.equal(shown,v3Brief(level),'the v3 brief, word for word');
    assert.notEqual(shown,sequenceBrief(level),'and not the v2 one');
    // The two differ in what they promise, so the wrong one is recognisable on sight.
    assert.match(shown,/striped crystal/,'v3 explains its own specials');
    assert.doesNotMatch(shown,/^Reach 500 points\. 25 moves\.$/,'never the old fixed line');
  }
});

test('The v2 brief is never even asked for on a v3 run',()=>{
  let asked=0;
  const shown=sequenceObjective(3,7,{v2:level=>{asked++;return sequenceBrief(level);},v3:v3Brief});
  assert.equal(asked,0,'only one brief is built, so only one line can ever be drawn');
  assert.equal(shown,v3Brief(7));
});

test('A v1 or v2 run keeps the brief it has always had',()=>{
  for(const version of [1,2]){
    assert.equal(sequenceObjective(version,5,BRIEFS),sequenceBrief(5));
  }
});

test('The move count and the opening goal come from the same ruleset as the brief',()=>{
  for(const level of [1,6,20]){
    assert.equal(sequenceMoves(3,level,LEVELS),v3Level(level).moves,'v3 sets its own moves per level');
    assert.equal(sequenceMoves(2,level,LEVELS),SEQUENCE_V2_MOVES,'v2 was always 25');
    assert.equal(sequenceMoves(1,level,LEVELS),SEQUENCE_V2_MOVES);
    assert.equal(sequenceTargetFor(3,level,LEVELS),v3Level(level).target);
    assert.equal(sequenceTargetFor(2,level,LEVELS),sequenceLevel(level).target);
  }
  // The bug this fixes: a v3 level whose move count is not 25 was still being described as 25 moves.
  const differs=[1,2,3,4,5,6,8,10,15,20,30].find(level=>v3Level(level).moves!==SEQUENCE_V2_MOVES);
  assert.ok(differs,'at least one v3 level does not run on 25 moves');
  assert.notEqual(sequenceMoves(3,differs,LEVELS),sequenceMoves(2,differs,LEVELS));
});
