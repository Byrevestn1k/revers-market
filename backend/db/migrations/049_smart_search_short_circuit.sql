-- Category and parent names are shared by many listings. Check them first so
-- exact matches can avoid expensive fuzzy comparisons in lower-scoring fields.
CREATE OR REPLACE FUNCTION smart_search_matches(
    title_terms text[], description_terms text[], category_terms text[], parent_category_terms text[],
    unit_terms text[], owner_terms text[], query_words text[]
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    field_order integer[] := ARRAY[3, 4, 1, 2, 5, 6];
    field_terms text[];
    token text;
    token_stem text;
    word text;
    word_stem text;
    token_index integer;
    position integer;
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
        FOR position IN 1..6 LOOP
            field_index := field_order[position];
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

CREATE OR REPLACE FUNCTION smart_search_score_fast(
    title_terms text[], description_terms text[], category_terms text[], parent_category_terms text[],
    unit_terms text[], owner_terms text[], listing_title text, query_words text[], query_phrase text
) RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    weights integer[] := ARRAY[30, 12, 8, 6, 2, 1];
    field_order integer[] := ARRAY[3, 4, 1, 2, 5, 6];
    field_terms text[];
    token_scores integer[];
    token_stems text[] := ARRAY[]::text[];
    token_count integer := COALESCE(array_length(query_words, 1), 0);
    position integer;
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
    FOR position IN 1..6 LOOP
        field_index := field_order[position];
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
                    WHEN token_scores[token_index] < 80 + weights[field_index]
                        AND length(query_words[token_index]) >= 4 AND word_stem = token_stems[token_index]
                        THEN 80 + weights[field_index]
                    WHEN token_scores[token_index] < 65 + weights[field_index]
                        AND length(query_words[token_index]) >= 4 AND word LIKE query_words[token_index] || '%'
                        THEN 65 + weights[field_index]
                    WHEN token_scores[token_index] < 42 + weights[field_index]
                        AND length(query_words[token_index]) >= 5 AND query_words[token_index] !~ '[0-9]' AND word !~ '[0-9]'
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
