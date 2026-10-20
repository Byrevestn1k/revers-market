CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated text follows edits automatically and includes only public listing fields.
ALTER TABLE products ADD COLUMN search_text text GENERATED ALWAYS AS (lower(title || ' ' || description || ' ' || unit)) STORED;
ALTER TABLE buy_requests ADD COLUMN search_text text GENERATED ALWAYS AS (lower(title || ' ' || description || ' ' || unit)) STORED;
CREATE INDEX products_search_text_idx ON products USING gin (search_text gin_trgm_ops) WHERE status = 'active';
CREATE INDEX buy_requests_search_text_idx ON buy_requests USING gin (search_text gin_trgm_ops)
    WHERE status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled');
CREATE INDEX categories_search_name_idx ON categories USING gin (name gin_trgm_ops);

CREATE FUNCTION smart_search_stem(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN value ~ '^(детск|ребен|дитин|дитяч)' THEN 'дитяч'
        WHEN regexp_replace(value, '(ами|ями|ого|ому|ими|ыми|ої|ий|ій|ых|их|ів|ев|ов|ом|ем|у|ю|а|я|и|і|ы|е|о)$', '') IN ('яблук', 'яблок') THEN 'яблук'
        WHEN value IN ('самсунг', 'samsung') THEN 'samsung'
        ELSE regexp_replace(value, '(ами|ями|ого|ому|ими|ыми|ої|ий|ій|ых|их|ів|ев|ов|ом|ем|у|ю|а|я|и|і|ы|е|о)$', '')
    END
$$;

CREATE FUNCTION smart_search_score(
    listing_title text, listing_description text, category_name text, parent_category_name text,
    listing_unit text, owner_name text, query_words text[], query_phrase text
) RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    fields text[] := ARRAY[listing_title, listing_description, category_name, parent_category_name, listing_unit, owner_name];
    weights integer[] := ARRAY[30, 12, 8, 6, 2, 1];
    token_scores integer[];
    token_stems text[] := ARRAY[]::text[];
    token_count integer := COALESCE(array_length(query_words, 1), 0);
    field_index integer;
    token_index integer;
    word text;
    word_stem text;
    candidate integer;
    matched integer := 0;
    total integer := 0;
BEGIN
    IF token_count = 0 THEN RETURN 0; END IF;
    token_scores := array_fill(0, ARRAY[token_count]);
    FOR token_index IN 1..token_count LOOP
        token_stems := array_append(token_stems, smart_search_stem(query_words[token_index]));
    END LOOP;
    FOR field_index IN 1..6 LOOP
        FOREACH word IN ARRAY regexp_split_to_array(
            regexp_replace(lower(COALESCE(fields[field_index], '')), '([0-9]+)[vв]([^[:alnum:]]|$)', E'\\1 в\\2', 'g'),
            '[^[:alnum:]а-яіїєґё]+'
        ) LOOP
            IF word = '' THEN CONTINUE; END IF;
            word_stem := smart_search_stem(word);
            FOR token_index IN 1..token_count LOOP
                candidate := CASE
                    WHEN word = query_words[token_index] THEN 100 + weights[field_index]
                    WHEN length(query_words[token_index]) >= 4 AND word_stem = token_stems[token_index] THEN 80 + weights[field_index]
                    WHEN length(query_words[token_index]) >= 4 AND word LIKE query_words[token_index] || '%' THEN 65 + weights[field_index]
                    WHEN length(query_words[token_index]) >= 5 AND query_words[token_index] !~ '[0-9]' AND word !~ '[0-9]'
                        AND similarity(word, query_words[token_index]) >= (CASE WHEN length(query_words[token_index]) <= 6 THEN 0.58 ELSE 0.48 END)
                        THEN 42 + weights[field_index]
                    ELSE 0
                END;
                IF candidate > token_scores[token_index] THEN token_scores[token_index] := candidate; END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    FOR token_index IN 1..token_count LOOP
        IF token_scores[token_index] > 0 THEN
            matched := matched + 1;
            total := total + token_scores[token_index];
        ELSIF query_words[token_index] ~ '[0-9]' THEN
            RETURN 0;
        END IF;
    END LOOP;
    IF matched < CEIL(token_count * 0.6) THEN RETURN 0; END IF;
    RETURN matched * 10000 / token_count + total
        + CASE WHEN strpos(lower(COALESCE(listing_title, '')), lower(query_phrase)) > 0 THEN 300 ELSE 0 END;
END
$$;
