import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArticles } from '../src/articles.js';

test('a minimal article is filled with defaults', () => {
  const result = validateArticles([{ headline: 'Tests Go Green', body: 'All of them.' }]);
  assert.equal(result.ok, true);
  const [a] = result.articles;
  assert.equal(a.id, 'tests-go-green');
  assert.equal(a.size, 'standard');
  assert.equal(a.words, 3);
  assert.deepEqual(a.sources, []);
});

test('the { articles } wrapper is accepted', () => {
  assert.equal(validateArticles({ articles: [{ headline: 'h', body: 'b' }] }).ok, true);
});

test('missing headline or body, a bad size and an empty list are rejected', () => {
  assert.equal(validateArticles([]).ok, false);
  const result = validateArticles([{ body: 'b' }, { headline: 'h' }, { headline: 'h', body: 'b', size: 'huge' }]);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
});

test('a body over 1000 words is rejected', () => {
  const result = validateArticles([{ headline: 'Long', body: 'word '.repeat(1001) }]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /1001 words/);
});

test('duplicate ids are made unique', () => {
  const result = validateArticles([{ headline: 'Same', body: 'a' }, { headline: 'Same', body: 'b' }]);
  const ids = result.articles.map((a) => a.id);
  assert.equal(new Set(ids).size, 2);
});
