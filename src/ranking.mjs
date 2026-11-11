// Lexical + optional semantic ranking shared by long-term memory and the
// video knowledge base. Chinese bigrams avoid a native segmentation package.
export function tokens(text) {
  const result = [];
  for (const part of String(text).normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}_]+/gu) || []) {
    if (/\p{Script=Han}/u.test(part)) {
      const chars = Array.from(part);
      if (chars.length === 1) result.push(part);
      else for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
    } else result.push(part);
  }
  return result;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function rankMemories(rows, query, vector, fingerprint) {
  const terms = [...new Set(tokens(query))];
  const docs = rows.map(row => {
    const words = tokens(row.key + ' ' + row.content + ' ' + row.tags), frequency = new Map();
    for (const word of words) frequency.set(word, (frequency.get(word) || 0) + 1);
    return { row, length: words.length, frequency };
  });
  const average = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  const df = new Map(terms.map(t => [t, docs.filter(d => d.frequency.has(t)).length]));
  const scores = docs.map(d => {
    let lexical = 0;
    for (const term of terms) {
      const tf = d.frequency.get(term) || 0;
      if (tf) lexical += Math.log(1 + (rows.length - df.get(term) + 0.5) / (df.get(term) + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / Math.max(1, average)));
    }
    if (query.trim() && (d.row.key + ' ' + d.row.content).toLowerCase().includes(query.trim().toLowerCase())) lexical += 2;
    // Provider/model identity is checked as well as dimensions.
    const semantic = vector && d.row.embedding_model === fingerprint ? cosine(vector, JSON.parse(d.row.embedding || 'null')) : 0;
    return { ...d, lexical, semantic };
  });
  const lexical = scores.filter(s => s.lexical > 0).sort((a, b) => b.lexical - a.lexical);
  const semantic = scores.filter(s => s.semantic > 0.25).sort((a, b) => b.semantic - a.semantic);
  const ranks = new Map();
  for (const list of [lexical, semantic]) list.forEach((s, i) => ranks.set(s.row.id, (ranks.get(s.row.id) || 0) + 1 / (40 + i + 1)));
  return scores.filter(s => ranks.has(s.row.id)).map(s => ({ ...s.row, score: ranks.get(s.row.id) * (0.75 + 0.25 * s.row.importance) })).sort((a, b) => b.score - a.score || b.updated_at - a.updated_at);
}
