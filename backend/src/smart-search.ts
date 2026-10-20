export type SearchColumns = {
  title: string;
  description: string;
  category: string;
  parentCategory: string;
  unit: string;
  owner: string;
  indexedText: string;
  indexTable: 'products' | 'buy_requests' | 'step15_bench';
  rowId: string;
  titleTerms: string;
  descriptionTerms: string;
  categoryTerms: string;
  parentCategoryTerms: string;
  unitTerms: string;
  ownerTerms: string;
  fallbackKeysFrom: string;
  fallbackKeysCte: string;
  fallbackKeySelect: string;
  fallbackListingTable: string;
  fallbackJoinCondition: string;
  fallbackId: string;
  fallbackFields: string[];
};

export function listingSearchColumns(kind: 'product' | 'buyRequest'): SearchColumns {
  const alias = kind === 'product' ? 'p' : 'r';
  return {
    title: `${alias}.title`, description: `${alias}.description`, category: 'c.name', parentCategory: 'parent_c.name',
    unit: `${alias}.unit`, owner: "concat_ws(' ', u.username, u.nickname)", indexedText: `${alias}.search_text`,
    indexTable: kind === 'product' ? 'products' : 'buy_requests', rowId: `${alias}.id`,
    titleTerms: `${alias}.search_title_terms`, descriptionTerms: `${alias}.search_description_terms`,
    categoryTerms: 'c.search_name_terms', parentCategoryTerms: 'parent_c.search_name_terms',
    unitTerms: `${alias}.search_unit_terms`, ownerTerms: 'u.search_public_name_terms',
    fallbackKeysCte: kind === 'product' ? 'SELECT DISTINCT category_id, owner_id FROM products' : 'SELECT DISTINCT category_id, buyer_id FROM buy_requests',
    fallbackKeysFrom: kind === 'product'
      ? 'search_keys JOIN categories fallback_c ON fallback_c.id = search_keys.category_id LEFT JOIN categories fallback_parent_c ON fallback_parent_c.id = fallback_c.parent_id JOIN users fallback_u ON fallback_u.id = search_keys.owner_id'
      : 'search_keys JOIN categories fallback_c ON fallback_c.id = search_keys.category_id LEFT JOIN categories fallback_parent_c ON fallback_parent_c.id = fallback_c.parent_id JOIN users fallback_u ON fallback_u.id = search_keys.buyer_id',
    fallbackKeySelect: kind === 'product' ? 'search_keys.category_id, search_keys.owner_id' : 'search_keys.category_id, search_keys.buyer_id',
    fallbackListingTable: kind === 'product' ? 'products search_fallback' : 'buy_requests search_fallback',
    fallbackJoinCondition: kind === 'product'
      ? 'matched_keys.category_id = search_fallback.category_id AND matched_keys.owner_id = search_fallback.owner_id'
      : 'matched_keys.category_id = search_fallback.category_id AND matched_keys.buyer_id = search_fallback.buyer_id',
    fallbackId: 'search_fallback.id',
    fallbackFields: ['fallback_c.name', 'fallback_parent_c.name', "concat_ws(' ', fallback_u.username, fallback_u.nickname)"],
  };
}

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
  if (!tokens.length) return { condition: 'FALSE', rank: '0::integer' };
  const tokenIndex = parameters.push(tokens);
  const phraseIndex = parameters.push(query.trim().slice(0, 160));
  const terms = titleOnly
    ? [columns.titleTerms, ...Array(5).fill("'{}'::text[]")]
    : [columns.titleTerms, columns.descriptionTerms, columns.categoryTerms, columns.parentCategoryTerms, columns.unitTerms, columns.ownerTerms];
  const rank = `smart_search_score_fast(${terms.join(', ')}, ${columns.title}, $${tokenIndex}::text[], $${phraseIndex}::text)`;
  const matches = `smart_search_matches(${terms.join(', ')}, $${tokenIndex}::text[])`;
  const candidateFields = titleOnly ? [columns.title] : [columns.indexedText, columns.category, columns.parentCategory, columns.owner];
  const indexedSelects: string[] = [];
  const regexFragments: string[] = [];
  const fuzzyClauses: string[] = [];
  const nonIndexedCandidates: string[] = [];
  tokens.forEach((token) => {
    const nonIndexedVariants: string[] = [];
    candidateVariants(token).forEach((variant) => {
      const wordIndex = parameters.push(variant);
      const fuzzyPrefix = variant.length >= 7 && !/\d/.test(variant) ? variant.slice(0, 4) : null;
      regexFragments.push(variant);
      if (fuzzyPrefix) regexFragments.push(fuzzyPrefix);
      fuzzyClauses.push(`$${wordIndex}::text <% search_candidate.search_text`);
      if (!titleOnly) {
        const patternIndex = parameters.push(`%${variant}%`);
        const fuzzyPrefixIndex = fuzzyPrefix ? parameters.push(`%${fuzzyPrefix}%`) : null;
        const indexedMatch = (field: string) => `(${field} ILIKE $${patternIndex} OR $${wordIndex}::text <% ${field}${fuzzyPrefixIndex ? ` OR ${field} ILIKE $${fuzzyPrefixIndex}` : ''})`;
        nonIndexedVariants.push(`(${columns.fallbackFields.map(indexedMatch).join(' OR ')})`);
      }
    });
    nonIndexedCandidates.push(nonIndexedVariants.length ? `(${nonIndexedVariants.join(' OR ')})` : 'FALSE');
  });
  const required = Math.ceil(tokens.length * 0.6);
  const regexIndex = parameters.push([...new Set(regexFragments)].join('|'));
  indexedSelects.unshift(`SELECT search_candidate.id FROM ${columns.indexTable} search_candidate WHERE search_candidate.search_text ~* $${regexIndex}::text`);
  indexedSelects.push(`SELECT search_candidate.id FROM ${columns.indexTable} search_candidate WHERE ${fuzzyClauses.join(' OR ')}`);
  const nonIndexedCoverage = titleOnly ? 'FALSE' : `(${nonIndexedCandidates.map((candidate) => `CASE WHEN ${candidate} THEN 1 ELSE 0 END`).join(' + ')}) >= ${required}`;
  const fallbackIds = `SELECT ${columns.fallbackId} FROM ${columns.fallbackListingTable} JOIN (
    WITH search_keys AS MATERIALIZED (${columns.fallbackKeysCte}),
         matched_keys AS MATERIALIZED (SELECT ${columns.fallbackKeySelect} FROM ${columns.fallbackKeysFrom} WHERE ${nonIndexedCoverage})
    SELECT * FROM matched_keys
  ) matched_keys ON ${columns.fallbackJoinCondition}`;
  const candidateIds = `${indexedSelects.join(' UNION ')} UNION ${fallbackIds}`;
  const prefilter = `${columns.rowId} IN (${candidateIds})`;
  // A typed % or _ is literal text; these characters cannot broaden an ILIKE match.
  const literalCondition = /[%_]/.test(query)
    ? ` AND (${candidateFields.map((field) => `strpos(lower(${field}), lower($${parameters.push(query.trim().slice(0, 160))}::text)) > 0`).join(' OR ')})`
    : '';
  // Keep the phrase parameter typed in COUNT queries, which intentionally omit rank.
  return { condition: `(CASE WHEN ${prefilter} THEN ${matches}${literalCondition} ELSE FALSE END) AND $${phraseIndex}::text IS NOT NULL`, rank };
}
