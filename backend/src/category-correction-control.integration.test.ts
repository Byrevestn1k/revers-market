import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL) {
  const { pool } = await import('./db/client.js');
  const { assessCategory } = await import('./category-recommendation.js');
  const good = [
    { category: 'market-children--ihrashky--ihrashkovyy-transport', description: 'Невелика модель для дитячої гри.', titles: ['Іграшковий автомобіль BMW синій', 'Игрушечный автомобиль Ford красный', 'Іграшкова машина для дитини', 'Модель автомобіля у масштабі 1 24'] },
    { category: 'market-children--ihrashky--lyalky-ta-pupsy', description: 'Річ підходить до ляльки.', titles: ['Медичний халат для ляльки Барбі', 'Медицинский халат для куклы', 'Одяг для ляльки медсестри', 'Халат для ляльки з набором'] },
    { category: 'market-fashion--aksesuary--sharfy-i-rukavychky', description: 'Пара рукавичок, інші речі не продаються.', titles: ['Велосипедні рукавички розмір M', 'Перчатки для велосипеда новые', 'Рукавички велосипедні Trek чорні', 'Спортивні рукавички для велосипедиста'] },
    { category: 'apples', description: 'Продається врожай яблук, додаток без оплати.', titles: ['Яблука Голден, пляшка соку у подарунок', 'Яблоки Гала, игрушка в подарок', 'Свіжі яблука, велосипед у подарунок', 'Продаю яблука, дитяча машинка у подарунок'] },
    { category: 'market-auto--lehkovi-avtomobili', description: 'Справжній легковий транспорт у робочому стані.', titles: ['Автомобіль Toyota Corolla 2012', 'Автомобиль Skoda Octavia дизель', 'Легковий автомобіль для пасіки', 'Автомобіль медового кольору Renault'] },
    { category: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', description: 'Робочий телефон з зарядним пристроєм.', titles: ['Смартфон Samsung A54 чорний', 'Смартфон Xiaomi Redmi новий', 'Мобильный телефон Samsung Galaxy S22', 'Смартфон iPhone 13 на 128 ГБ'] },
    { category: 'market-home-garden--mebli--mebli-dlya-vitalni', description: 'Меблі для вітальні.', titles: ['Диван кутовий тканинний', 'Диван розкладний для кімнати', 'Угловой диван серый', 'Софа нова для вітальні'] },
    { category: 'market-hobbies--velo--velosypedy', description: 'Повний велосипед, не окремий аксесуар.', titles: ['Велосипед Giant міський зелений', 'Гірський велосипед Scott Aspect', 'Детский велосипед Trek 20 дюймов', 'Велосипед електричний для міста'] },
    { category: 'honey_raw', description: 'Їстівний продукт із пасіки.', titles: ['Мед акацієвий 1 кг', 'Мёд гречишный свежий', 'Куплю натуральний мед 5 л', 'Липовий мед від пасічника'] },
    { category: 'market-auto--prychepy-budynky-na-kolesakh', description: 'Причіп, вулики не входять у продаж.', titles: ['Причіп двовісний для пасіки', 'Прицеп бортовой для перевозки ульев', 'Вантажний причіп на дві осі', 'Причіп для перевезення обладнання'] },
  ];
  const wrong = [
    { truth: 'apples', chosen: 'market-auto--lehkovi-avtomobili', description: 'Урожай яблук у ящиках.', titles: ['Яблука Гала 10 кг', 'Яблоки Голден свежие', 'Сортові яблука для продажу', 'Яблука цьогорічного врожаю'] },
    { truth: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', chosen: 'honey_raw', description: 'Робочий смартфон з коробкою.', titles: ['Смартфон Samsung S23 Ultra', 'Смартфон iPhone 14 Pro', 'Мобильный телефон Xiaomi Redmi', 'Смартфон Galaxy A35'] },
    { truth: 'market-home-garden--mebli--mebli-dlya-vitalni', chosen: 'honey_raw', description: 'Меблі для вітальні.', titles: ['Диван кутовий бежевий', 'Диван розкладний новий', 'Угловой диван на кухню', 'Софа нова у гарному стані'] },
    { truth: 'honey_raw', chosen: 'market-auto--lehkovi-avtomobili', description: 'Їстівний мед у банках.', titles: ['Мед натуральний липовий 2 л', 'Мёд свежий акациевый', 'Куплю мед у відрах', 'Мед гречаний від пасічника 3 кг'] },
    { truth: 'market-hobbies--velo--velosypedy', chosen: 'processed_food', description: 'Цілий велосипед із колесами.', titles: ['Велосипед дитячий Giant 16', 'Гірський велосипед Trek Marlin', 'Городской велосипед Scott', 'Електровелосипед для міста'] },
    { truth: 'market-auto--lehkovi-avtomobili', chosen: 'market-fashion--krasa-zdorov-ya', description: 'Легкова машина на ходу.', titles: ['Автомобіль Toyota Camry 2015', 'Автомобиль Ford Focus бензин', 'Автомобіль Renault Duster 2018', 'Легковий автомобіль Skoda Fabia'] },
    { truth: 'market-children--ihrashky--ihrashkovyy-transport', chosen: 'market-auto--lehkovi-avtomobili', description: 'Дитяча іграшка, не справжнє авто.', titles: ['Іграшковий автомобіль Mercedes', 'Игрушечный автомобиль BMW', 'Іграшкова машина пожежна', 'Модель автомобіля у масштабі 1 32'] },
    { truth: 'market-fashion--aksesuary--sharfy-i-rukavychky', chosen: 'market-hobbies--velo--velosypedy', description: 'Окремий аксесуар для рук.', titles: ['Велосипедні рукавички XL', 'Перчатки для велосипеда M', 'Рукавички велосипедні спортивні', 'Рукавички для велосипедиста сині'] },
    { truth: 'market-business-services--prodazh-obladnannya-dlya-biznesu', chosen: 'honey_raw', description: 'Промислове обладнання, не харчовий товар.', titles: ['Медогонка електрична на 4 рамки', 'Насос для фасування меду', 'Оборудование для фасовки меда', 'Медогонка промислова з мотором'] },
    { truth: 'market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah', chosen: 'honey_raw', description: 'Спеціальний одяг для роботи.', titles: ['Медичний халат жіночий білий', 'Медицинский халат мужской', 'Медичний халат розмір L', 'Медицинский халат новый'] },
  ];
  const ambiguous = ['Насос без маркування', 'Кабель чорний 2 метри', 'Зарядка універсальна', 'Батарея змінна', 'Адаптер білий', 'Мотор робочий',
    'Насос невідомої моделі', 'Кабель у коробці', 'Зарядний пристрій без назви', 'Батарейка велика', 'Адаптер для пристрою', 'Мотор для проєкту',
    'Комплект різних деталей', 'Набір товарів для дому', 'Подарунковий комплект речей', 'Запчастини в асортименті', 'Прилад для роботи',
    'Коробка з інструментами', 'Невідомий аксесуар', 'Декоративна річ без опису'];

  describe('independent Step 16 correction control set with real category tree', () => {
    it('measures 100 new Ukrainian and Russian listings', async () => {
      const rows = await pool.query<{ id: string; code: string }>('SELECT id, code FROM categories WHERE is_active');
      const ids = new Map(rows.rows.map(row => [row.code, row.id]));
      expect(good.length * 4 + wrong.length * 4 + ambiguous.length).toBe(100);
      const used = new Set<string>();
      const missedWrong: string[] = [], topThreeMisses: string[] = [];
      let topThree = 0, topThreeTotal = 0, falseBlocks = 0, falseWarnings = 0, wrongDetected = 0, wrongBlocked = 0, ambiguousBlocked = 0, unresolved = 0;
      for (const group of good) for (const title of group.titles) {
        const categoryId = ids.get(group.category);
        expect(categoryId, group.category).toBeTruthy();
        used.add(title);
        const result = await assessCategory({ title, description: group.description, categoryId });
        topThreeTotal++; if (result.suggestions.some(item => item.id === categoryId)) topThree++; else topThreeMisses.push(title);
        if (result.level === 'block') falseBlocks++;
        if (result.level === 'warn') falseWarnings++;
        if (!result.suggestions.length) unresolved++;
      }
      for (const group of wrong) for (const title of group.titles) {
        const categoryId = ids.get(group.chosen), truth = ids.get(group.truth);
        expect(categoryId && truth, group.truth).toBeTruthy();
        used.add(title);
        const result = await assessCategory({ title, description: group.description, categoryId });
        topThreeTotal++; if (result.suggestions.some(item => item.id === truth)) topThree++; else topThreeMisses.push(title);
        if (result.level !== 'allow') wrongDetected++; else missedWrong.push(title);
        if (result.level === 'block') wrongBlocked++;
        if (!result.suggestions.length) unresolved++;
      }
      for (const title of ambiguous) {
        used.add(title);
        const result = await assessCategory({ title, categoryId: ids.get('market-electronics') });
        if (result.level === 'block') ambiguousBlocked++;
        if (!result.suggestions.length) unresolved++;
      }
      expect(used.size).toBe(100);
      expect(falseBlocks).toBe(0);
      expect(wrongBlocked).toBe(0);
      expect(ambiguousBlocked).toBe(0);
      console.info('Step 16 independent 100:', { topThree, topThreeTotal, topThreeMisses, falseBlocks, falseWarnings, wrongDetected, wrongBlocked, falseNegatives: 40 - wrongDetected, missedWrong, ambiguousBlocked, unresolved });
    }, 60_000);
  });
} else describe.skip('Step 16 correction control set requires DATABASE_URL', () => {});
