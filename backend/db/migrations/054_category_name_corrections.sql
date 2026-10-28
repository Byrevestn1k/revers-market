-- Correct two names found while reviewing the complete category tree.
-- IDs, hierarchy and listing/subscription links remain unchanged.
UPDATE categories SET name = 'Інші легкові автомобілі', updated_at = now()
WHERE code = 'market-auto--avtomobili-z-polshchi--pozosta-e-osobowe'
  AND name <> 'Інші легкові автомобілі';

UPDATE categories SET name = 'Інші автозапчастини', updated_at = now()
WHERE code = 'market-auto-parts--avtozapchastyny--inshi-avtozapchastyn'
  AND name <> 'Інші автозапчастини';
