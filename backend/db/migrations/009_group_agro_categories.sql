INSERT INTO categories (code, name, path)
VALUES
    ('apiculture', 'Продукти бджільництва', 'agriculture/apiculture'),
    ('livestock', 'Тваринництво', 'agriculture/livestock'),
    ('poultry', 'Птахівництво', 'agriculture/poultry'),
    ('aquaculture', 'Риба та аквакультура', 'agriculture/aquaculture'),
    ('feed', 'Корми', 'agriculture/feed'),
    ('horticulture', 'Садівництво та ягоди', 'agriculture/horticulture'),
    ('planting_material', 'Насіння та посадковий матеріал', 'agriculture/planting-material'),
    ('industrial_crops', 'Технічні культури', 'agriculture/industrial-crops'),
    ('processed_food', 'Фермерська переробка', 'agriculture/processed-food'),
    ('animal_products', 'Продукти тваринництва', 'agriculture/animal-products'),
    ('other_agro', 'Інше', 'agriculture/other')
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    path = EXCLUDED.path,
    is_active = true,
    updated_at = now();

UPDATE categories child
SET parent_id = parent.id
FROM categories parent
WHERE child.is_active
  AND parent.is_active
  AND child.code <> parent.code
  AND (
      (child.path LIKE 'agriculture/crops/grains/%' AND parent.code = 'grains') OR
      (child.path LIKE 'agriculture/crops/pulses/%' AND parent.code = 'legumes') OR
      (child.path LIKE 'agriculture/crops/oilseeds/%' AND parent.code = 'oilseeds') OR
      (child.path LIKE 'agriculture/crops/vegetables/%' AND parent.code = 'vegetables') OR
      (child.path LIKE 'agriculture/crops/greens/%' AND parent.code = 'herbs') OR
      (child.path LIKE 'agriculture/crops/melons/%' AND parent.code = 'vegetables') OR
      (child.path LIKE 'agriculture/crops/industrial/%' AND parent.code = 'industrial_crops') OR
      (child.path LIKE 'agriculture/horticulture/fruits/%' AND parent.code = 'fruits') OR
      (child.path LIKE 'agriculture/horticulture/berries/%' AND parent.code = 'berries') OR
      (child.path LIKE 'agriculture/horticulture/nuts/%' AND parent.code = 'nuts') OR
      (child.path LIKE 'agriculture/horticulture/%' AND parent.code = 'horticulture') OR
      (child.path LIKE 'agriculture/planting-material/%' AND parent.code = 'planting_material') OR
      (child.path LIKE 'agriculture/feed/%' AND parent.code = 'feed') OR
      (child.path LIKE 'agriculture/livestock/%' AND parent.code = 'livestock') OR
      (child.path LIKE 'agriculture/poultry/%' AND parent.code = 'poultry') OR
      (child.path LIKE 'agriculture/aquaculture/%' AND parent.code = 'aquaculture') OR
      (child.path LIKE 'agriculture/beekeeping/%' AND parent.code = 'apiculture') OR
      (child.path LIKE 'agriculture/animal-products/beekeeping/%' AND parent.code = 'apiculture') OR
      (child.path LIKE 'agriculture/animal-products/dairy/%' AND parent.code = 'dairy') OR
      (child.path LIKE 'agriculture/animal-products/meat/%' AND parent.code = 'meat') OR
      (child.path LIKE 'agriculture/animal-products/eggs/%' AND parent.code = 'eggs') OR
      (child.path LIKE 'agriculture/animal-products/raw-materials/%' AND parent.code = 'animal_products') OR
      (child.path LIKE 'agriculture/animal-products/fertilizers/%' AND parent.code = 'animal_products') OR
      (child.path LIKE 'agriculture/processed/%' AND parent.code = 'processed_food')
  );

UPDATE categories
SET parent_id = NULL
WHERE code IN ('grains', 'legumes', 'oilseeds', 'vegetables', 'fruits', 'berries', 'nuts', 'herbs', 'dairy', 'meat', 'eggs', 'honey', 'apiculture', 'livestock', 'poultry', 'aquaculture', 'feed', 'horticulture', 'planting_material', 'industrial_crops', 'processed_food', 'animal_products', 'other_agro');
