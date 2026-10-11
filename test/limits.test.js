import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTarget, targetRange, resolveLimits } from '../src/limits.js';

const HOUR = 60 * 60 * 1000;
const window = (hours) => [new Date(0).toISOString(), new Date(hours * HOUR).toISOString()];

test('the default target is about 7 stories per 12 hours, between 3 and 15', () => {
  assert.equal(defaultTarget(...window(12)), 7);
  assert.equal(defaultTarget(...window(1)), 3);
  assert.equal(defaultTarget(...window(24 * 7)), 15);
});

test('the target can go down to 3 or up by half the default, at most 5', () => {
  assert.deepEqual(targetRange(3), { min: 3, max: 5 });
  assert.deepEqual(targetRange(7), { min: 3, max: 11 });
  assert.deepEqual(targetRange(15), { min: 3, max: 20 });
});

test('limits default to the suggested target and 1000 words', () => {
  const { limits, errors } = resolveLimits({}, ...window(12));
  assert.deepEqual(errors, []);
  assert.deepEqual(limits, { target: 7, defaultTarget: 7, maxWords: 1000 });
});

test('limits out of range are rejected', () => {
  assert.equal(resolveLimits({ target: 12 }, ...window(12)).errors.length, 1);
  assert.equal(resolveLimits({ target: 2 }, ...window(12)).errors.length, 1);
  assert.equal(resolveLimits({ maxWords: 99 }, ...window(12)).errors.length, 1);
  assert.equal(resolveLimits({ maxWords: 3001 }, ...window(12)).errors.length, 1);
  assert.equal(resolveLimits({ target: 'lots' }, ...window(12)).errors.length, 1);
  assert.deepEqual(resolveLimits({ target: '11', maxWords: 3000 }, ...window(12)).limits, { target: 11, defaultTarget: 7, maxWords: 3000 });
});
