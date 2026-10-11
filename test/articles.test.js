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

test('the word limit can be changed per edition', () => {
  assert.equal(validateArticles([{ headline: 'h', body: 'word '.repeat(1500) }], { maxWords: 2000 }).ok, true);
  const result = validateArticles([{ headline: 'h', body: 'word '.repeat(301) }], { maxWords: 300 });
  assert.match(result.errors[0], /301 words, max is 300/);
});

test('full stories may not exceed the target, but one In Brief is extra', () => {
  const story = (i) => ({ headline: `Story ${i}`, body: 'b' });
  const brief = { headline: 'In Brief', body: 'b', kind: 'brief' };
  assert.equal(validateArticles([story(1), story(2), story(3), brief], { target: 3 }).ok, true);
  assert.match(validateArticles([story(1), story(2), story(3), story(4)], { target: 3 }).errors[0], /4 stories, target is 3/);
  assert.match(validateArticles([story(1), brief, { ...brief, headline: 'More' }]).errors[0], /at most one/);
  assert.match(validateArticles([{ headline: 'h', body: 'b', kind: 'oped' }]).errors[0], /kind/);
});

test('an In Brief is marked as one', () => {
  const [a, b] = validateArticles([{ headline: 'h', body: 'b' }, { headline: 'In Brief', body: 'b', kind: 'brief' }]).articles;
  assert.equal(a.kind, 'story');
  assert.equal(b.kind, 'brief');
});

test('duplicate ids are made unique', () => {
  const result = validateArticles([{ headline: 'Same', body: 'a' }, { headline: 'Same', body: 'b' }]);
  const ids = result.articles.map((a) => a.id);
  assert.equal(new Set(ids).size, 2);
});
