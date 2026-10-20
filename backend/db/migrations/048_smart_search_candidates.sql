-- Split words once when a listing, category or public owner name changes.
CREATE FUNCTION smart_search_term_pairs(value text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    word text;
    result text[] := ARRAY[]::text[];
BEGIN
    FOREACH word IN ARRAY regexp_split_to_array(
        regexp_replace(lower(COALESCE(value, '')), '([0-9]+)[vв]([^[:alnum:]]|$)', E'\\1 в\\2', 'g'),
        '[^[:alnum:]а-яіїєґё]+'
    ) LOOP
        IF word <> '' THEN
            result := array_append(result, word);
            result := array_append(result, smart_search_stem(word));
        END IF;
    END LOOP;
    RETURN result;
END
$$;

ALTER TABLE products
    ADD COLUMN search_title_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(title)) STORED,
    ADD COLUMN search_description_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(description)) STORED,
    ADD COLUMN search_unit_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(unit)) STORED;
ALTER TABLE buy_requests
    ADD COLUMN search_title_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(title)) STORED,
    ADD COLUMN search_description_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(description)) STORED,
    ADD COLUMN search_unit_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(unit)) STORED;
ALTER TABLE categories ADD COLUMN search_name_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(name)) STORED;
ALTER TABLE users ADD COLUMN search_public_name_terms text[] GENERATED ALWAYS AS (smart_search_term_pairs(COALESCE(username, '') || ' ' || COALESCE(nickname, ''))) STORED;

-- The first migration used partial indexes. A full index also covers an owner's
-- paused listings, while the public status filter remains in the outer query.
DROP INDEX products_search_text_idx;
DROP INDEX buy_requests_search_text_idx;
CREATE INDEX products_search_text_idx ON products USING gin (search_text gin_trgm_ops);
CREATE INDEX buy_requests_search_text_idx ON buy_requests USING gin (search_text gin_trgm_ops);

CREATE FUNCTION smart_search_matches(
    title_terms text[], description_terms text[], category_terms text[], parent_category_terms text[],
    unit_terms text[], owner_terms text[], query_words text[]
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    field_terms text[];
    token text;
    token_stem text;
    word text;
    word_stem text;
    token_index integer;
    field_index integer;
    word_index integer;
    found boolean;
    matched integer := 0;
    token_count integer := COALESCE(array_length(query_words, 1), 0);
BEGIN
    IF token_count = 0 THEN RETURN false; END IF;
    FOR token_index IN 1..token_count LOOP
        token := query_words[token_index];
        token_stem := smart_search_stem(token);
        found := false;
        FOR field_index IN 1..6 LOOP
            field_terms := CASE field_index
                WHEN 1 THEN title_terms WHEN 2 THEN description_terms WHEN 3 THEN category_terms
                WHEN 4 THEN parent_category_terms WHEN 5 THEN unit_terms ELSE owner_terms END;
            IF COALESCE(array_length(field_terms, 1), 0) = 0 THEN CONTINUE; END IF;
            FOR word_index IN 1..array_length(field_terms, 1) BY 2 LOOP
                word := field_terms[word_index];
                word_stem := field_terms[word_index + 1];
                IF word = token
                    OR (length(token) >= 4 AND word_stem = token_stem)
                    OR (length(token) >= 4 AND word LIKE token || '%')
                    OR (length(token) >= 5 AND token !~ '[0-9]' AND word !~ '[0-9]'
                        AND similarity(word, token) >= (CASE WHEN length(token) <= 6 THEN 0.58 ELSE 0.48 END)) THEN
                    found := true;
                    EXIT;
                END IF;
            END LOOP;
            IF found THEN EXIT; END IF;
        END LOOP;
        IF found THEN matched := matched + 1;
        ELSIF token ~ '[0-9]' THEN RETURN false;
        END IF;
        IF matched + token_count - token_index < CEIL(token_count * 0.6) THEN RETURN false; END IF;
    END LOOP;
    RETURN matched >= CEIL(token_count * 0.6);
END
$$;

CREATE FUNCTION smart_search_score_fast(
    title_terms text[], description_terms text[], category_terms text[], parent_category_terms text[],
    unit_terms text[], owner_terms text[], listing_title text, query_words text[], query_phrase text
) RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    weights integer[] := ARRAY[30, 12, 8, 6, 2, 1];
    field_terms text[];
    token_scores integer[];
    token_stems text[] := ARRAY[]::text[];
    token_count integer := COALESCE(array_length(query_words, 1), 0);
    field_index integer;
    token_index integer;
    word_index integer;
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
        field_terms := CASE field_index
            WHEN 1 THEN title_terms WHEN 2 THEN description_terms WHEN 3 THEN category_terms
            WHEN 4 THEN parent_category_terms WHEN 5 THEN unit_terms ELSE owner_terms END;
        IF COALESCE(array_length(field_terms, 1), 0) = 0 THEN CONTINUE; END IF;
        FOR word_index IN 1..array_length(field_terms, 1) BY 2 LOOP
            word := field_terms[word_index];
            word_stem := field_terms[word_index + 1];
            FOR token_index IN 1..token_count LOOP
                IF token_scores[token_index] >= 100 + weights[field_index] THEN CONTINUE; END IF;
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
