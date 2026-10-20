import { describe, expect, it } from 'vitest';
import { searchTokens, smartSearchSql } from './smart-search.js';

const columns = { title: 'p.title', description: 'p.description', category: 'c.name', parentCategory: 'parent_c.name', unit: 'p.unit', owner: 'u.username', indexedText: 'p.search_text' };

describe('smart search input', () => {
  it('keeps all meaningful words in any order, including models and units', () => {
    expect(searchTokens('  Насос   для води 12v  ')).toEqual(['насос', 'води', '12', 'в']);
    expect(searchTokens('Samsung Galaxy S23 Ultra')).toEqual(['samsung', 'galaxy', 's23', 'ultra']);
    expect(searchTokens('велосипед дитячий')).toEqual(['велосипед', 'дитячий']);
  });

  it('bounds costly input and binds tokens without embedding SQL', () => {
    const parameters: unknown[] = [];
    const injection = "велосипед' OR 1=1 --";
    const search = smartSearchSql(columns, injection, parameters)!;
    expect(search.condition).not.toContain(injection);
    expect(parameters[0]).toEqual(['велосипед', 'or', '1']);
    expect(searchTokens('word '.repeat(100))).toHaveLength(1);
    expect(searchTokens('!@#')).toEqual([]);
    expect(smartSearchSql(columns, '   ', [])).toBeNull();
    const literalParameters: unknown[] = [];
    const literal = smartSearchSql(columns, 'велосипед%', literalParameters)!;
    expect(literal.condition).toContain('strpos(lower(');
    expect(literal.condition).not.toContain('велосипед%');
    expect(literalParameters).toContain('велосипед%');
  });
});
