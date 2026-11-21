import { expect, it } from 'vitest';
import { emptyCounts, matchRates, parseCounts, recordAction } from '../src/shared/matchAnalytics';
import type { CombatEvent } from '../src/shared/types';

it('uses hand-specific attempts, lean starts, and resolved incoming attack direction', () => {
  const counts = emptyCounts();
  const events: Omit<CombatEvent,'timestampMs'>[] = [
    {type:'PLAYER_PUNCH_THROW',side:'LEFT'}, {type:'PLAYER_PUNCH_THROW',side:'LEFT'},
    {type:'PLAYER_PUNCH_COUNTER_HIT',side:'LEFT'}, {type:'PLAYER_LEAN',side:'RIGHT'},
    {type:'PLAYER_DODGE_SUCCESS',side:'LEFT',attackSide:'RIGHT'},
    {type:'BOSS_STRIKE_HIT_PLAYER',side:'RIGHT'}, {type:'BOSS_STRIKE_START',side:'RIGHT'},
  ];
  for (const event of events) recordAction(counts, {...event,timestampMs:0});
  expect(matchRates(counts).map(r=>[r.count,r.total])).toEqual([[1,2],[0,0],[1,1],[0,0],[1,2],[0,0]]);
  expect(parseCounts({...counts, leftLanded:3})).toBeNull();
  expect(parseCounts({...counts, arbitrary:'ignore'})).toEqual(counts);
});
