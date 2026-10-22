import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL) {
  const { pool } = await import('./db/client.js');
  const { assessCategory } = await import('./category-recommendation.js');
  type Case = { title: string; chosen: string; truth: string | null; expected: 'allow' | 'warn'; description?: string };

  const reviewer: Case[] = [
    { title: 'Чохол для автомобіля Toyota', chosen: 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', truth: 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', expected: 'allow' },
    { title: 'Чехол для автомобиля Toyota', chosen: 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', truth: 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', expected: 'allow' },
    { title: 'Килимки для автомобіля Toyota', chosen: 'market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky', truth: 'market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky', expected: 'allow' },
    { title: 'Запчастина для автомобіля Toyota', chosen: 'market-auto-parts--avtozapchastyny', truth: 'market-auto-parts--avtozapchastyny', expected: 'allow' },
    { title: 'Іграшкова модель автомобіля Toyota', chosen: 'market-children--ihrashky--ihrashkovyy-transport', truth: 'market-children--ihrashky--ihrashkovyy-transport', expected: 'allow' },
    { title: 'Велосипед Trek для ляльки', chosen: 'market-children--ihrashky--lyalky-ta-pupsy', truth: 'market-children--ihrashky--lyalky-ta-pupsy', expected: 'allow' },
    { title: 'Сумка для велосипеда Trek', chosen: 'market-hobbies--velo--veloaksesuary', truth: 'market-hobbies--velo--veloaksesuary', expected: 'allow' },
    { title: 'Смартфон Samsung із чохлом у подарунок', chosen: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', truth: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', expected: 'allow' },
    { title: 'Мед липовий, медогонка у подарунок', chosen: 'honey_raw', truth: 'honey_raw', expected: 'allow' },
    { title: 'Автомобіль Toyota, велосипед Trek у подарунок', chosen: 'market-auto--lehkovi-avtomobili', truth: 'market-auto--lehkovi-avtomobili', expected: 'allow' },
    { title: 'Мёд липовый, ложка в подарок', chosen: 'honey_raw', truth: 'honey_raw', expected: 'allow' },
    { title: 'Рамка для вуликів', chosen: 'apiculture', truth: 'apiculture', expected: 'allow' },
    { title: 'Насос 12В', chosen: 'market-electronics', truth: null, expected: 'allow' },
    { title: 'Мед', chosen: 'honey_raw', truth: 'honey_raw', expected: 'allow' },
    { title: 'Автомобіль Toyota', chosen: 'market-auto--lehkovi-avtomobili', truth: 'market-auto--lehkovi-avtomobili', expected: 'allow' },
    { title: 'Мед натуральний', chosen: 'market-auto--lehkovi-avtomobili', truth: 'honey_raw', expected: 'warn' },
    { title: 'Яблоки Гала свежие', chosen: 'market-auto--lehkovi-avtomobili', truth: 'apples', expected: 'warn' },
    { title: 'Смартфон Samsung S24', chosen: 'honey_raw', truth: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', expected: 'warn' },
    { title: 'Диван угловой новый', chosen: 'honey_raw', truth: 'market-home-garden--mebli--mebli-dlya-vitalni', expected: 'warn' },
    { title: 'Велосипед Trek дитячий', chosen: 'processed_food', truth: 'market-hobbies--velo--velosypedy', expected: 'warn' },
    { title: 'Мед натуральний', chosen: 'market-auto--lehkovi-avtomobili', truth: 'honey_raw', expected: 'warn', description: 'На фото автомобіль Toyota, назва описує мед' },
    { title: 'Автомобіль Toyota', chosen: 'honey_raw', truth: 'market-auto--lehkovi-avtomobili', expected: 'warn', description: 'Продаю мед із пасіки, фото авто для прикладу' },
  ];

  const control: Case[] = [
    // 30 distinct correctly placed contextual listings.
    { title: 'Захисний чохол до авто Skoda', chosen: 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', truth: 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', expected: 'allow' },
    { title: 'Чехол для смартфона Xiaomi', chosen: 'market-electronics--telefony-ta-aksesuary--aksesuary-dlya-telefoniv', truth: 'market-electronics--telefony-ta-aksesuary--aksesuary-dlya-telefoniv', expected: 'allow' },
    { title: 'Чохол для телефона iPhone 13', chosen: 'market-electronics--telefony-ta-aksesuary--aksesuary-dlya-telefoniv', truth: 'market-electronics--telefony-ta-aksesuary--aksesuary-dlya-telefoniv', expected: 'allow' },
    { title: 'Коврики для автомобиля Ford', chosen: 'market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky', truth: 'market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky', expected: 'allow' },
    { title: 'Фара для Toyota Corolla', chosen: 'market-auto-parts--avtozapchastyny--fary-ta-osvitlennya', truth: 'market-auto-parts--avtozapchastyny--fary-ta-osvitlennya', expected: 'allow' },
    { title: 'Запчастини до трактора МТЗ', chosen: 'market-auto-parts--zapchastyny-dlya-silhosptekhniky', truth: 'market-auto-parts--zapchastyny-dlya-silhosptekhniky', expected: 'allow' },
    { title: 'Детали для трактора John Deere', chosen: 'market-auto-parts--zapchastyny-dlya-silhosptekhniky', truth: 'market-auto-parts--zapchastyny-dlya-silhosptekhniky', expected: 'allow' },
    { title: 'Запчастина до велосипеда Giant', chosen: 'market-hobbies--velo--veloaksesuary', truth: 'market-hobbies--velo--veloaksesuary', expected: 'allow' },
    { title: 'Сумка для ноутбука Lenovo', chosen: 'market-electronics--noutbuky-ta-aksesuary--aksesuary-dlya-noutbukiv', truth: 'market-electronics--noutbuky-ta-aksesuary--aksesuary-dlya-noutbukiv', expected: 'allow' },
    { title: 'Сумка для велосипеда Scott', chosen: 'market-hobbies--velo--veloaksesuary', truth: 'market-hobbies--velo--veloaksesuary', expected: 'allow' },
    { title: 'Зарядний пристрій для автомобіля Ford', chosen: 'market-auto-parts--aksesuary-dlya-avto--puskovi-ta-zaryadni-prystroyi', truth: 'market-auto-parts--aksesuary-dlya-avto--puskovi-ta-zaryadni-prystroyi', expected: 'allow' },
    { title: 'Зарядка для авто Renault', chosen: 'market-auto-parts--aksesuary-dlya-avto--puskovi-ta-zaryadni-prystroyi', truth: 'market-auto-parts--aksesuary-dlya-avto--puskovi-ta-zaryadni-prystroyi', expected: 'allow' },
    { title: 'Корм для собак великих порід', chosen: 'market-animals--zootovary--tovary-dlya-sobak', truth: 'market-animals--zootovary--tovary-dlya-sobak', expected: 'allow' },
    { title: 'Корм для пса сухий', chosen: 'market-animals--zootovary--tovary-dlya-sobak', truth: 'market-animals--zootovary--tovary-dlya-sobak', expected: 'allow' },
    { title: 'Кабель для сонячної панелі 5 м', chosen: 'market-electronics--aksesuary-y-komplektuyuchi', truth: 'market-electronics--aksesuary-y-komplektuyuchi', expected: 'allow' },
    { title: 'Іграшкова пральна машина дитяча', chosen: 'market-children--ihrashky', truth: 'market-children--ihrashky', expected: 'allow' },
    { title: 'Игрушечная стиральная машина', chosen: 'market-children--ihrashky', truth: 'market-children--ihrashky', expected: 'allow' },
    { title: 'Халат для куклы врача', chosen: 'market-children--ihrashky--lyalky-ta-pupsy', truth: 'market-children--ihrashky--lyalky-ta-pupsy', expected: 'allow' },
    { title: 'Одяг для ляльки ручної роботи', chosen: 'market-children--ihrashky--lyalky-ta-pupsy', truth: 'market-children--ihrashky--lyalky-ta-pupsy', expected: 'allow' },
    { title: 'Обладнання для фасування меду', chosen: 'market-business-services--prodazh-obladnannya-dlya-biznesu', truth: 'market-business-services--prodazh-obladnannya-dlya-biznesu', expected: 'allow' },
    { title: 'Оборудование для фасовки меда', chosen: 'market-business-services--prodazh-obladnannya-dlya-biznesu', truth: 'market-business-services--prodazh-obladnannya-dlya-biznesu', expected: 'allow' },
    { title: 'Автомобіль із комплектом килимків Toyota', chosen: 'market-auto--lehkovi-avtomobili', truth: 'market-auto--lehkovi-avtomobili', expected: 'allow' },
    { title: 'Мед липовий, ліхтар у подарунок', chosen: 'honey_raw', truth: 'honey_raw', expected: 'allow' },
    { title: 'Яблука Голден, чохол для авто у подарунок', chosen: 'apples', truth: 'apples', expected: 'allow' },
    { title: 'Велосипед Giant, шолом у подарунок', chosen: 'market-hobbies--velo--velosypedy', truth: 'market-hobbies--velo--velosypedy', expected: 'allow' },
    { title: 'Причіп для перевезення рамок', chosen: 'market-auto--prychepy-budynky-na-kolesakh', truth: 'market-auto--prychepy-budynky-na-kolesakh', expected: 'allow' },
    { title: 'Автомобіль кольору меду Skoda', chosen: 'market-auto--lehkovi-avtomobili', truth: 'market-auto--lehkovi-avtomobili', expected: 'allow' },
    { title: 'Смартфон Pixel з чохлом у комплекті', chosen: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', truth: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', expected: 'allow' },
    { title: 'Игрушечный автомобиль BMW', chosen: 'market-children--ihrashky--ihrashkovyy-transport', truth: 'market-children--ihrashky--ihrashkovyy-transport', expected: 'allow' },
    { title: 'Молоко домашнє у пляшках', chosen: 'milk', truth: 'milk', expected: 'allow' },
    // 20 obvious wrong roots: 10 direct goods and 10 relational goods.
    { title: 'Мед гречаний фермерський 5 кг', chosen: 'market-auto--lehkovi-avtomobili', truth: 'honey_raw', expected: 'warn' },
    { title: 'Яблука свіжого врожаю 15 кг', chosen: 'market-auto--lehkovi-avtomobili', truth: 'apples', expected: 'warn' },
    { title: 'Смартфон Samsung Galaxy S25', chosen: 'honey_raw', truth: 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', expected: 'warn' },
    { title: 'Диван кутовий синій новий', chosen: 'honey_raw', truth: 'market-home-garden--mebli--mebli-dlya-vitalni', expected: 'warn' },
    { title: 'Дитячий велосипед Trek 18', chosen: 'processed_food', truth: 'market-hobbies--velo--velosypedy', expected: 'warn' },
    { title: 'Автомобіль Toyota Corolla 2014', chosen: 'honey_raw', truth: 'market-auto--lehkovi-avtomobili', expected: 'warn' },
    { title: 'Медичний халат жіночий білий', chosen: 'honey_raw', truth: 'market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah', expected: 'warn' },
    { title: 'Причіп бортовий двовісний', chosen: 'processed_food', truth: 'market-auto--prychepy-budynky-na-kolesakh', expected: 'warn' },
    { title: 'Медогонка електрична промислова', chosen: 'honey_raw', truth: 'market-business-services--prodazh-obladnannya-dlya-biznesu', expected: 'warn' },
    { title: 'Цукор білий мішок 20 кг', chosen: 'market-auto--lehkovi-avtomobili', truth: 'processed_food', expected: 'warn' },
    { title: 'Чехол для смартфона Huawei', chosen: 'honey_raw', truth: 'market-electronics--telefony-ta-aksesuary--aksesuary-dlya-telefoniv', expected: 'warn' },
    { title: 'Килимки до автомобіля Skoda', chosen: 'honey_raw', truth: 'market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky', expected: 'warn' },
    { title: 'Фара для Ford Focus', chosen: 'honey_raw', truth: 'market-auto-parts--avtozapchastyny--fary-ta-osvitlennya', expected: 'warn' },
    { title: 'Запчастини до трактора МТЗ 80', chosen: 'honey_raw', truth: 'market-auto-parts--zapchastyny-dlya-silhosptekhniky', expected: 'warn' },
    { title: 'Сумка до ноутбука Asus', chosen: 'honey_raw', truth: 'market-electronics--noutbuky-ta-aksesuary--aksesuary-dlya-noutbukiv', expected: 'warn' },
    { title: 'Зарядний пристрій для автомобіля Toyota', chosen: 'honey_raw', truth: 'market-auto-parts--aksesuary-dlya-avto--puskovi-ta-zaryadni-prystroyi', expected: 'warn' },
    { title: 'Корм для собак сухий 10 кг', chosen: 'market-auto--lehkovi-avtomobili', truth: 'market-animals--zootovary--tovary-dlya-sobak', expected: 'warn' },
    { title: 'Кабель для сонячної панелі бухта', chosen: 'honey_raw', truth: 'market-electronics--aksesuary-y-komplektuyuchi', expected: 'warn' },
    { title: 'Іграшкова пральна машина для дітей', chosen: 'honey_raw', truth: 'market-children--ihrashky', expected: 'warn' },
    { title: 'Рамка для вуликів дерев’яна', chosen: 'market-auto--lehkovi-avtomobili', truth: 'apiculture', expected: 'warn' },
    // 20 ambiguous or mixed listings. Never block automatically.
    ...[
      'Насос для невідомої системи', 'Кабель універсальний 2 м', 'Сумка без призначення', 'Запчастина невідомої моделі',
      'Зарядка для пристрою', 'Комплект деталей різних типів', 'Річ для дому', 'Товар для ремонту',
      'Мед чи обладнання?', 'Авто або іграшка?', 'Панель із кабелем', 'Подарунковий набір',
      'Мотор для проєкту', 'Чохол універсальний', 'Фара невідомої техніки', 'Батарея для техніки',
      'Кабель для різних моделей', 'Сумка для подорожей', 'Аксесуари у коробці', 'Декор для кімнати',
    ].map(title => ({ title, chosen: 'market-electronics', truth: null, expected: 'allow' as const })),
  ];

  async function measure(cases: Case[]) {
    const rows = await pool.query<{ id: string; code: string }>('SELECT id, code FROM categories WHERE is_active');
    const ids = new Map(rows.rows.map(row => [row.code, row.id]));
    let top3 = 0, eligible = 0, falseBlocks = 0, falseWarnings = 0, wrongDetected = 0, wrongBlocked = 0, ambiguousBlocked = 0, unresolved = 0;
    const misses: string[] = [];
    for (const item of cases) {
      const chosen = ids.get(item.chosen), truth = item.truth ? ids.get(item.truth) : null;
      expect(chosen, item.chosen).toBeTruthy();
      if (item.truth) expect(truth, item.truth).toBeTruthy();
      const result = await assessCategory({ title: item.title, description: item.description, categoryId: chosen });
      if (!item.truth) expect(result.certainty, item.title).toBe('uncertain');
      if (truth) { eligible++; if (result.suggestions.some(suggestion => suggestion.id === truth)) top3++; else misses.push(item.title); }
      if (item.expected === 'allow' && item.truth && result.level === 'block') falseBlocks++;
      if (item.expected === 'allow' && item.truth && result.level === 'warn') falseWarnings++;
      if (item.expected !== 'allow' && result.level !== 'allow') wrongDetected++;
      if (item.expected !== 'allow' && result.level === 'block') wrongBlocked++;
      if (item.expected === 'allow' && !item.truth && result.level === 'block') ambiguousBlocked++;
      if (!result.suggestions.length) unresolved++;
      if (item.expected === 'warn') expect(result.level, item.title).toBe('warn');
    }
    return { top3, eligible, falseBlocks, falseWarnings, wrongDetected, wrongBlocked, ambiguousBlocked, unresolved, misses };
  }

  describe('Step 16 subject relations on the active PostgreSQL category tree', () => {
    it('recognizes a cover named directly before the car it fits', async () => {
      const rows = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM categories WHERE code = ANY($1::text[]) AND is_active",
        [['market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky', 'market-auto--lehkovi-avtomobili']],
      );
      const ids = new Map(rows.rows.map(row => [row.code, row.id]));
      const cover = ids.get('market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky');
      const car = ids.get('market-auto--lehkovi-avtomobili');
      expect(cover && car).toBeTruthy();
      for (const title of ['Чохол автомобіля Toyota', 'Чехол автомобиля Ford']) {
        const correct = await assessCategory({ title, categoryId: cover });
        expect(correct.level).toBe('allow');
        expect(correct.suggestions[0]?.id).toBe(cover);
        expect((await assessCategory({ title, categoryId: car })).level).toBe('warn');
      }
    });
    it('replays the 22 independent Sol examples', async () => {
      expect(reviewer).toHaveLength(22);
      const result = await measure(reviewer);
      expect(result.falseBlocks).toBe(0);
      expect(result.falseWarnings).toBe(0);
      expect(result.top3).toBe(21);
      expect(result.wrongDetected).toBe(7);
      expect(result.wrongBlocked).toBe(0);
      console.info('Step 16 Sol 22 replay:', result);
    }, 60_000);
    it('checks a new 70-case mix of products, compatibility, gifts and uncertainty', async () => {
      expect(control).toHaveLength(70);
      expect(new Set(control.map(item => item.title)).size).toBe(70);
      const result = await measure(control);
      expect(result.wrongBlocked).toBe(0);
      expect(result.falseBlocks).toBe(0);
      expect(result.falseWarnings).toBe(0);
      expect(result.ambiguousBlocked).toBe(0);
      expect(result.top3).toBe(50);
      expect(result.wrongDetected).toBe(20);
      console.info('Step 16 independent 70:', result);
    }, 60_000);
  });
} else describe.skip('Step 16 subject relations require DATABASE_URL', () => {});
