import { DEFAULT_MAX_WORDS } from './limits.js';

export const SIZES = ['breaking', 'major', 'standard'];
// A brief is the edition's "In Brief" round-up; it does not count toward the story target.
export const KINDS = ['story', 'brief'];

export function wordCount(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function slug(text, index) {
  const base = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return base || `article-${index + 1}`;
}

// `limits` comes from the commission: maxWords per article and, when set, the target number of stories.
export function validateArticles(input, { maxWords = DEFAULT_MAX_WORDS, target } = {}) {
  const list = Array.isArray(input) ? input : input?.articles;
  const errors = [];
  if (!Array.isArray(list)) {
    return { ok: false, errors: ['expected an array of articles or { "articles": [...] }'] };
  }
  if (list.length === 0) errors.push('at least one article is required');

  const seen = new Set();
  const articles = list.map((raw, i) => {
    const where = `articles[${i}]`;
    const a = raw && typeof raw === 'object' ? raw : {};
    if (!a.headline || typeof a.headline !== 'string') errors.push(`${where}: headline is required`);
    if (!a.body || typeof a.body !== 'string') errors.push(`${where}: body (markdown) is required`);
    const words = wordCount(a.body ?? '');
    if (words > maxWords) errors.push(`${where}: body is ${words} words, max is ${maxWords}`);
    const size = a.size ?? 'standard';
    if (!SIZES.includes(size)) errors.push(`${where}: size must be one of ${SIZES.join(', ')}`);
    const kind = a.kind ?? 'story';
    if (!KINDS.includes(kind)) errors.push(`${where}: kind must be one of ${KINDS.join(', ')}`);
    if (a.sources !== undefined && !Array.isArray(a.sources)) errors.push(`${where}: sources must be an array`);
    const sources = (Array.isArray(a.sources) ? a.sources : [])
      .filter((s) => s && typeof s === 'object' && s.url)
      .map((s) => ({ label: String(s.label ?? s.url), url: String(s.url) }));

    let id = a.id ? String(a.id) : slug(a.headline ?? '', i);
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);

    return {
      id,
      headline: String(a.headline ?? ''),
      dek: String(a.dek ?? ''),
      section: String(a.section ?? 'General'),
      size,
      kind,
      byline: String(a.byline ?? 'Staff Reporter'),
      publishedAt: String(a.publishedAt ?? new Date().toISOString()),
      sources,
      body: String(a.body ?? ''),
      words,
    };
  });

  const stories = articles.filter((a) => a.kind === 'story').length;
  const briefs = articles.length - stories;
  if (target !== undefined && stories > target) {
    errors.push(`${stories} stories, target is ${target}: merge the smaller ones into the In Brief`);
  }
  if (briefs > 1) errors.push(`${briefs} briefs: an edition has at most one In Brief`);

  return errors.length ? { ok: false, errors } : { ok: true, articles };
}
