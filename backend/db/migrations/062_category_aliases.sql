CREATE TABLE category_aliases (
    category_id uuid NOT NULL REFERENCES categories(id),
    alias text NOT NULL,
    PRIMARY KEY (category_id, alias)
);

INSERT INTO category_aliases (category_id, alias)
SELECT c.id, x.alias FROM (VALUES
('market-auto--lehkovi-avtomobili', 'легковик'), ('market-auto--lehkovi-avtomobili', 'авто'),
('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'мобільний телефон'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'смартфон'),
('market-hobbies--velo--velosypedy', 'велосипед'), ('market-hobbies--velo--velosypedy', 'байк'),
('grains', 'зерно'), ('apiculture', 'мед')
) AS x(category_code, alias) JOIN categories c ON c.code = x.category_code;
