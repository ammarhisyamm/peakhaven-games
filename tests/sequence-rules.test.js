import test from 'node:test';
import assert from 'node:assert/strict';
import {createSequenceBoard,hasSequenceMove,sequenceMatches,sequenceSwap,settleSequence,sequenceTarget,SEQUENCE_SIZE,SEQUENCE_MOVES} from '../dist/sequence-rules.js';

function seeded(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}

test('Sequence boards start clean and higher levels add color choices and a larger goal',()=>{
  for(let level of [1,5,6,20,80]){
    const board=createSequenceBoard(level,seeded(level));
    assert.equal(board.length,SEQUENCE_SIZE**2);
    assert.equal(sequenceMatches(board).size,0);
    assert.ok(board.every(color=>color>=0&&color<Math.min(7,4+Math.floor((level-1)/5))));
  }
  assert.equal(SEQUENCE_MOVES,25);
  assert.ok(sequenceTarget(55)>sequenceTarget(54));assert.ok(sequenceTarget(80)>=sequenceTarget(79));
});

test('Sequence always begins with a legal swap, even with a deterministic random source',()=>{
  for(const level of [1,5,6,11,30]){
    const board=createSequenceBoard(level,()=>0);
    assert.equal(sequenceMatches(board).size,0);
    assert.equal(hasSequenceMove(board),true);
  }
});

test('Sequence accepts adjacent swaps only when they make a match',()=>{
  const board=createSequenceBoard(1,seeded(9));
  assert.equal(sequenceSwap(board,0,48),null);
  const fixture=board.slice();fixture[0]=0;fixture[1]=1;fixture[2]=0;fixture[8]=0;
  const next=sequenceSwap(fixture,1,8);
  assert.ok(next);
  assert.equal(sequenceMatches(next).size>=3,true);
  assert.equal(fixture[1],1,'validation must leave the original board untouched');
});

test('Sequence gravity closes holes and refills every cell',()=>{
  const board=createSequenceBoard(1,seeded(37));board[4]=-1;board[11]=-1;board[18]=-1;
  const next=settleSequence(board,seeded(38),SEQUENCE_SIZE,4);
  assert.equal(next.length,board.length);
  assert.ok(next.every(color=>Number.isInteger(color)&&color>=0&&color<4));
});
