export const SIZES = ['breaking', 'major', 'standard'];
export const MAX_WORDS = 1000;

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

export function validateArticles(input) {
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
    if (words > MAX_WORDS) errors.push(`${where}: body is ${words} words, max is ${MAX_WORDS}`);
    const size = a.size ?? 'standard';
    if (!SIZES.includes(size)) errors.push(`${where}: size must be one of ${SIZES.join(', ')}`);
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
      byline: String(a.byline ?? 'Staff Reporter'),
      publishedAt: String(a.publishedAt ?? new Date().toISOString()),
      sources,
      body: String(a.body ?? ''),
      words,
    };
  });

  return errors.length ? { ok: false, errors } : { ok: true, articles };
}
