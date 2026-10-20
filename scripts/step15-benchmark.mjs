import 'dotenv/config';
import pg from 'pg';
import { smartSearchSql } from '../backend/src/smart-search.ts';

// All rows and indexes live only in this connection's temporary schema.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const size = 10_000;
const columns = {
  title: 'p.title', description: 'p.description', category: 'p.category', parentCategory: 'p.parent_category',
  unit: 'p.unit', owner: 'p.owner', indexedText: 'p.search_text', indexTable: 'step15_bench', rowId: 'p.id',
  titleTerms: 'p.search_title_terms', descriptionTerms: 'p.search_description_terms',
  categoryTerms: 'p.search_category_terms', parentCategoryTerms: 'p.search_parent_category_terms',
  unitTerms: 'p.search_unit_terms', ownerTerms: 'p.search_owner_terms',
  fallbackKeysCte: 'SELECT DISTINCT category, parent_category, owner FROM step15_bench',
  fallbackKeysFrom: 'search_keys',
  fallbackKeySelect: 'search_keys.category, search_keys.parent_category, search_keys.owner',
  fallbackListingTable: 'step15_bench search_fallback',
  fallbackJoinCondition: 'matched_keys.category = search_fallback.category AND matched_keys.parent_category = search_fallback.parent_category AND matched_keys.owner = search_fallback.owner',
  fallbackId: 'search_fallback.id',
  fallbackFields: ['search_keys.category', 'search_keys.parent_category', 'search_keys.owner'],
};
const cases = [
  ['one', 'велосипед'], ['three', 'червоний дитячий велосипед'],
  ['five', 'червоний дитячий велосипед trek 20'], ['typo', 'велосепед'],
  ['geography', 'велосипед'], ['category-price', 'велосипед'],
];
const indexes = (plan) => {
  const found = [];
  const visit = (node) => { if (node['Index Name']) found.push(node['Index Name']); for (const child of node.Plans ?? []) visit(child); };
  visit(plan);
  return [...new Set(found)];
};
const explain = async (sql, params) => {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const data = result.rows[0]['QUERY PLAN'][0];
  return { ms: Number(data['Execution Time'].toFixed(2)), indexes: indexes(data.Plan), plan: data.Plan };
};
const outline = (node, depth = 0) => [{ depth, type: node['Node Type'], relation: node['Relation Name'], index: node['Index Name'], rows: node['Actual Rows'], loops: node['Actual Loops'], ms: node['Actual Total Time'] }, ...(node.Plans ?? []).flatMap(child => outline(child, depth + 1))];

await client.connect();
try {
  await client.query(`CREATE TEMP TABLE step15_bench AS
    SELECT n AS id,
      CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
           WHEN n % 7 = 0 THEN 'Велосипед дитячий' ELSE 'Товар номер ' || n END AS title,
      CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
           WHEN n % 7 = 0 THEN 'Червоний велосипед' ELSE 'Звичайний опис' END AS description,
      'Велосипеди'::text AS category, ''::text AS parent_category,
      'шт'::text AS unit, 'тест'::text AS owner,
      'Рівне'::text AS region, (n % 5000)::numeric AS price,
      lower(CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
           WHEN n % 7 = 0 THEN 'Велосипед дитячий' ELSE 'Товар номер ' || n END || ' ' ||
           CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
           WHEN n % 7 = 0 THEN 'Червоний велосипед' ELSE 'Звичайний опис' END || ' шт') AS search_text,
      smart_search_term_pairs(CASE WHEN n % 10 = 0 THEN 'Червоний дитячий велосипед Trek 20'
           WHEN n % 7 = 0 THEN 'Велосипед дитячий' ELSE 'Товар номер ' || n END) AS search_title_terms,
      smart_search_term_pairs(CASE WHEN n % 10 = 0 THEN 'Насос для води 12 В червоний дитячий велосипед'
           WHEN n % 7 = 0 THEN 'Червоний велосипед' ELSE 'Звичайний опис' END) AS search_description_terms,
      smart_search_term_pairs('Велосипеди') AS search_category_terms,
      smart_search_term_pairs('') AS search_parent_category_terms,
      smart_search_term_pairs('шт') AS search_unit_terms,
      smart_search_term_pairs('тест') AS search_owner_terms
    FROM generate_series(1, $1) n`, [size]);
  await client.query('CREATE INDEX step15_bench_trgm ON step15_bench USING gin (search_text gin_trgm_ops)');
  await client.query('ANALYZE step15_bench');
  console.log(JSON.stringify({ rows: size, cache: 'one warm-up then three measured runs', dataset: 'same Step 15 synthetic rows; category shared by all' }));
  for (const [name, sql, values] of [
    ['trigram-substring', "SELECT count(*) FROM step15_bench WHERE search_text ILIKE $1", ['%червоний%']],
    ['trigram-word', "SELECT count(*) FROM step15_bench WHERE $1::text <% search_text", ['велосепед']],
  ]) {
    const result = await explain(sql, values);
    console.log(JSON.stringify({ control: name, ms: result.ms, indexes: result.indexes, plan: outline(result.plan) }));
  }

  for (const [label, phrase] of cases.filter(([label]) => !process.argv[2] || process.argv[2] === label)) {
    const params = [];
    const search = smartSearchSql(columns, phrase, params);
    const extra = label === 'geography' ? " AND p.region = 'Рівне'" : label === 'category-price' ? " AND p.category = 'Велосипеди' AND p.price <= 1000" : '';
    const from = `FROM step15_bench p WHERE ${search.condition}${extra}`;
    const statements = {
      count: `SELECT count(*) ${from}`,
      page1: `SELECT p.id ${from} ORDER BY ${search.rank} DESC, p.id DESC LIMIT 20 OFFSET 0`,
      page2: `SELECT p.id ${from} ORDER BY ${search.rank} DESC, p.id DESC LIMIT 20 OFFSET 20`,
    };
    for (const [operation, sql] of Object.entries(statements)) {
      await explain(sql, params);
      const runs = [];
      for (let n = 0; n < 3; n++) runs.push(await explain(sql, params));
      const middle = runs.map(run => run.ms).sort((a, b) => a - b)[1];
      console.log(JSON.stringify({ case: label, operation, medianMs: middle, indexes: runs[1].indexes,
        rootPlan: runs[1].plan['Node Type'], buffers: (runs[1].plan['Shared Hit Blocks'] ?? 0) + (runs[1].plan['Local Hit Blocks'] ?? 0) }));
      if (process.argv[3] === 'plan' && operation === 'page1') console.log(JSON.stringify({ case: label, plan: outline(runs[1].plan) }));
    }
  }
  for (const phrase of process.argv[2] ? [] : ['червоний дитячий велосипед', 'велосепед', 'Samsung Galaxy S23']) {
    const params = [];
    const search = smartSearchSql(columns, phrase, params);
    const compared = await client.query(`SELECT count(*) FILTER (WHERE old_score <> new_score)::int AS mismatches,
      count(*) FILTER (WHERE old_score > 0 AND NOT new_match)::int AS missed
      FROM (SELECT smart_search_score(p.title,p.description,p.category,p.parent_category,p.unit,p.owner,$1::text[],$2::text) old_score,
        ${search.rank} new_score, (${search.condition}) new_match FROM step15_bench p) scored`, params);
    console.log(JSON.stringify({ case: phrase, comparison: compared.rows[0] }));
  }
} finally {
  await client.end();
}
