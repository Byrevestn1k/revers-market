export type SearchColumns = {
  title: string;
  description: string;
  category: string;
  parentCategory: string;
  unit: string;
  owner: string;
  indexedText: string;
};

const stopWords = new Set(['для', 'та', 'і', 'й', 'із', 'зі', 'на', 'по', 'до', 'від', 'або', 'и', 'или', 'с', 'со', 'от', 'к']);

function candidateVariants(token: string): string[] {
  if (token === 'в') return ['в', 'v'];
  if (/^(детск|ребен|дитин)/.test(token)) return [token, 'дитяч'];
  if (/^яблок/.test(token)) return [token, 'яблук'];
  if (token === 'самсунг') return [token, 'samsung'];
  return [token];
}

export function searchTokens(query: string): string[] {
  const normalized = query.slice(0, 160).toLocaleLowerCase('uk-UA')
    .replace(/(\d+)[vв](?![\p{L}\p{N}])/gu, '$1 в')
    .replace(/[’ʼ`´]/g, "'");
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const result: string[] = [];
  for (const [index, word] of words.entries()) {
    if (stopWords.has(word) && !(word === 'в' && index > 0 && /^\d+$/.test(words[index - 1]))) continue;
    if (!result.includes(word)) result.push(word);
    if (result.length === 12) break;
  }
  return result;
}

export function smartSearchSql(columns: SearchColumns, query: string | undefined, parameters: unknown[], titleOnly = false): { condition: string; rank: string } | null {
  if (!query?.trim()) return null;
  const tokens = searchTokens(query);
  if (!tokens.length) return { condition: 'FALSE', rank: '0' };
  const tokenIndex = parameters.push(tokens);
  const phraseIndex = parameters.push(query.trim().slice(0, 160));
  const fields = titleOnly
    ? [columns.title, "''", "''", "''", "''", "''"]
    : [columns.title, columns.description, columns.category, columns.parentCategory, columns.unit, columns.owner];
  const rank = `smart_search_score(${fields.join(', ')}, $${tokenIndex}::text[], $${phraseIndex}::text)`;
  const candidateFields = titleOnly ? [columns.title] : [columns.indexedText, columns.category, columns.parentCategory, columns.owner];
  const candidates = tokens.map((token) => `(${candidateVariants(token).map((variant) => {
    const wordIndex = parameters.push(variant);
    const patternIndex = parameters.push(`%${variant}%`);
    const fuzzyPrefixIndex = variant.length >= 7 && !/\d/.test(variant) ? parameters.push(`%${variant.slice(0, 4)}%`) : null;
    return `(${candidateFields.map((field) => `(${field} ILIKE $${patternIndex} OR $${wordIndex}::text <% ${field}${fuzzyPrefixIndex ? ` OR ${field} ILIKE $${fuzzyPrefixIndex}` : ''})`).join(' OR ')})`;
  }).join(' OR ')})`);
  const coverage = candidates.length > 1
    ? ` AND (${candidates.map((candidate) => `CASE WHEN ${candidate} THEN 1 ELSE 0 END`).join(' + ')}) >= ${Math.ceil(candidates.length * 0.6)}`
    : '';
  // A typed % or _ is literal text; these characters cannot broaden an ILIKE match.
  const literalCondition = /[%_]/.test(query)
    ? ` AND (${candidateFields.map((field) => `strpos(lower(${field}), lower($${parameters.push(query.trim().slice(0, 160))}::text)) > 0`).join(' OR ')})`
    : '';
  return { condition: `(${candidates.join(' OR ')})${coverage} AND ${rank} > 0${literalCondition}`, rank };
}
