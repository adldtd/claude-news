// How many stories an edition aims for and how long each may be.
// web/app.js keeps a copy of defaultTarget and targetRange so the form can update as the dates change.
export const MIN_TARGET = 3;
export const MAX_DEFAULT_TARGET = 15;
export const MAX_HEADROOM = 5;
export const DEFAULT_MAX_WORDS = 1000;
export const WORDS_RANGE = { min: 100, max: 3000 };

const HOUR = 60 * 60 * 1000;

// About 7 stories per 12 hours of window.
export function defaultTarget(since, until) {
  const hours = (new Date(until) - new Date(since)) / HOUR;
  return Math.min(MAX_DEFAULT_TARGET, Math.max(MIN_TARGET, Math.round((7 * hours) / 12)));
}

// The user can aim anywhere down to 3, or up by half the default (at most 5) for a busy window.
export function targetRange(suggested) {
  return { min: MIN_TARGET, max: suggested + Math.min(Math.ceil(suggested / 2), MAX_HEADROOM) };
}

function integer(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

export function resolveLimits(body, since, until) {
  const errors = [];
  const suggested = defaultTarget(since, until);
  const { min, max } = targetRange(suggested);
  const target = integer(body.target, suggested);
  const maxWords = integer(body.maxWords, DEFAULT_MAX_WORDS);
  if (!(target >= min && target <= max)) errors.push(`target must be a whole number from ${min} to ${max}`);
  if (!(maxWords >= WORDS_RANGE.min && maxWords <= WORDS_RANGE.max)) {
    errors.push(`maxWords must be a whole number from ${WORDS_RANGE.min} to ${WORDS_RANGE.max}`);
  }
  return { errors, limits: { target, defaultTarget: suggested, maxWords } };
}
