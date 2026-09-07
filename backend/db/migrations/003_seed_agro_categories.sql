INSERT INTO categories (code, name, path)
VALUES
    ('grains', 'Зернові', 'agriculture/grains'),
    ('legumes', 'Бобові', 'agriculture/legumes'),
    ('oilseeds', 'Олійні культури', 'agriculture/oilseeds'),
    ('vegetables', 'Овочі', 'agriculture/vegetables'),
    ('fruits', 'Фрукти', 'agriculture/fruits'),
    ('berries', 'Ягоди', 'agriculture/berries'),
    ('nuts', 'Горіхи', 'agriculture/nuts'),
    ('herbs', 'Зелень і трави', 'agriculture/herbs'),
    ('dairy', 'Молочні продукти', 'agriculture/dairy'),
    ('meat', 'М’ясо', 'agriculture/meat'),
    ('eggs', 'Яйця', 'agriculture/eggs'),
    ('honey', 'Мед і продукти бджільництва', 'agriculture/honey')
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    path = EXCLUDED.path,
    is_active = true,
    updated_at = now();
