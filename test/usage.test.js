import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findTranscripts, sumUsage } from '../src/usage.js';
import { tempDir } from './helpers.js';

const SESSION = 'abcd1234-0000-0000-0000-000000000000';
const line = (timestamp, id, usage, type = 'assistant') => JSON.stringify({ type, timestamp, message: { id, usage } });
const u = (input, output) => ({ input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output });

test('transcripts are found with their subagents, and odd session ids are refused', () => {
  const root = tempDir();
  mkdirSync(join(root, 'proj', SESSION, 'subagents'), { recursive: true });
  writeFileSync(join(root, 'proj', `${SESSION}.jsonl`), '');
  writeFileSync(join(root, 'proj', SESSION, 'subagents', 'agent-1.jsonl'), '');
  assert.equal(findTranscripts(SESSION, root).length, 2);
  assert.deepEqual(findTranscripts('../etc', root), []);
  assert.deepEqual(findTranscripts('ffff0000-0000', root), []);
});

test('usage counts each message once and only after the start time', () => {
  const file = join(tempDir(), 't.jsonl');
  writeFileSync(file, [
    line('2026-10-01T09:00:00Z', 'old', u(1000, 1000)),
    line('2026-10-01T10:00:01Z', 'a', u(5, 7)),
    line('2026-10-01T10:00:02Z', 'a', u(5, 9)),
    line('2026-10-01T10:00:03Z', 'b', u(3, 1)),
    line('2026-10-01T10:00:04Z', 'c', u(99, 99), 'user'),
    'not json "usage"',
  ].join('\n'));
  const sum = sumUsage([file], '2026-10-01T10:00:00Z');
  assert.equal(sum.messages, 2);
  assert.equal(sum.input, 8);
  assert.equal(sum.output, 10);
  assert.equal(sum.total, 18);
});
