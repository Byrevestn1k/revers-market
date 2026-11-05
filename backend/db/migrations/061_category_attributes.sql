CREATE TABLE category_attribute_definitions (
    code text PRIMARY KEY,
    label text NOT NULL,
    value_type text NOT NULL CHECK (value_type IN ('text', 'number', 'number_unit', 'single', 'multiple', 'boolean')),
    options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
    unit text,
    min_value numeric,
    max_value numeric,
    required boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE category_attribute_assignments (
    category_id uuid NOT NULL REFERENCES categories(id),
    attribute_code text NOT NULL REFERENCES category_attribute_definitions(code),
    PRIMARY KEY (category_id, attribute_code)
);

ALTER TABLE products ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object');
ALTER TABLE buy_requests ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object');
ALTER TABLE offers ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object');

INSERT INTO category_attribute_definitions (code, label, value_type, options, unit, min_value, max_value, sort_order) VALUES
('brand', 'Виробник або марка', 'text', '[]', NULL, NULL, NULL, 10),
('model', 'Модель', 'text', '[]', NULL, NULL, NULL, 20),
('condition', 'Стан', 'single', '["Новий", "Вживаний", "Інший"]', NULL, NULL, NULL, 30),
('year', 'Рік випуску', 'number', '[]', NULL, 1886, 2100, 40),
('fuel', 'Тип пального', 'single', '["Бензин", "Дизель", "Газ", "Гібрид", "Електро", "Інший"]', NULL, NULL, NULL, 50),
('transmission', 'Коробка передач', 'single', '["Механічна", "Автоматична", "Інша"]', NULL, NULL, NULL, 60),
('mileage', 'Пробіг', 'number_unit', '[]', 'км', 0, 10000000, 70),
('storage', 'Пам’ять', 'number_unit', '[]', 'ГБ', 0, 100000, 40),
('colour', 'Колір', 'text', '[]', NULL, NULL, NULL, 50),
('phone_features', 'Особливості', 'multiple', '["Дві SIM", "5G", "NFC"]', NULL, NULL, NULL, 60),
('unlocked', 'Без прив’язки до оператора', 'boolean', '[]', NULL, NULL, NULL, 70),
('grain_type', 'Культура або сорт', 'text', '[]', NULL, NULL, NULL, 10),
('harvest_year', 'Рік врожаю', 'number', '[]', NULL, 1900, 2100, 20),
('honey_type', 'Вид продукту', 'text', '[]', NULL, NULL, NULL, 10);

INSERT INTO category_attribute_assignments (category_id, attribute_code)
SELECT c.id, x.attribute_code FROM (VALUES
('market-auto--lehkovi-avtomobili', 'brand'), ('market-auto--lehkovi-avtomobili', 'model'), ('market-auto--lehkovi-avtomobili', 'condition'), ('market-auto--lehkovi-avtomobili', 'year'), ('market-auto--lehkovi-avtomobili', 'fuel'), ('market-auto--lehkovi-avtomobili', 'transmission'), ('market-auto--lehkovi-avtomobili', 'mileage'),
('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'brand'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'model'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'condition'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'storage'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'colour'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'phone_features'), ('market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'unlocked'),
('market-hobbies--velo--velosypedy', 'brand'), ('market-hobbies--velo--velosypedy', 'model'), ('market-hobbies--velo--velosypedy', 'condition'),
('grains', 'grain_type'), ('grains', 'harvest_year'), ('apiculture', 'honey_type')
) AS x(category_code, attribute_code) JOIN categories c ON c.code = x.category_code;
