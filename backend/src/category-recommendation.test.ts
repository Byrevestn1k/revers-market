import { describe, expect, it } from 'vitest';
import { assessCategory } from './category-recommendation.js';

const rows = [
  ['market-agriculture', null, 'Сільське господарство'],
  ['apiculture', 'market-agriculture', 'Продукти бджільництва'],
  ['honey_raw', 'apiculture', 'Мед'],
  ['processed_food', 'market-agriculture', 'Фермерська переробка'],
  ['fruits', 'market-agriculture', 'Фрукти'],
  ['apples', 'fruits', 'Яблука'],
  ['dairy', 'market-agriculture', 'Молочні продукти'],
  ['milk', 'dairy', 'Молоко'],
  ['market-auto', null, 'Авто'],
  ['market-auto--lehkovi-avtomobili', 'market-auto', 'Легкові автомобілі'],
  ['market-auto--prychepy-budynky-na-kolesakh', 'market-auto', 'Причепи'],
  ['market-hobbies', null, 'Хобі'],
  ['market-hobbies--velo--velosypedy', 'market-hobbies', 'Велосипеди'],
  ['market-children', null, 'Діти'],
  ['market-children--ihrashky', 'market-children', 'Іграшки'],
  ['market-children--ihrashky--ihrashkovyy-transport', 'market-children--ihrashky', 'Іграшковий транспорт'],
  ['market-children--ihrashky--lyalky-ta-pupsy', 'market-children--ihrashky', 'Ляльки'],
  ['market-fashion', null, 'Мода'],
  ['market-fashion--aksesuary--sharfy-i-rukavychky', 'market-fashion', 'Рукавички'],
  ['market-fashion--krasa-zdorov-ya', 'market-fashion', 'Краса'],
  ['market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah', 'market-fashion', 'Медичний одяг'],
  ['market-business-services', null, 'Бізнес'],
  ['market-business-services--prodazh-obladnannya-dlya-biznesu', 'market-business-services', 'Продаж обладнання'],
  ['market-electronics', null, 'Електроніка'],
  ['market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony', 'market-electronics', 'Смартфони'],
  ['market-home-garden', null, 'Дім'],
  ['market-home-garden--mebli--mebli-dlya-vitalni', 'market-home-garden', 'Меблі для вітальні'],
].map(([code, parent_id, name]) => ({ id: code!, code: code!, parent_id, name: name! }));
const queryable = { query: async () => ({ rows }) } as any;

const groups = [
  { category: 'honey_raw', wrong: 'market-auto', titles: ['Мед натуральний 3 л', 'Продам мед акацієвий', 'Мёд липовый свежий', 'Куплю мед у відрах', 'Мед гречаний від пасічника'] },
  { category: 'market-hobbies--velo--velosypedy', wrong: 'dairy', titles: ['Велосипед дитячий Trek', 'Велосипед гірський Giant', 'Продам велосипед Scott', 'Куплю велосипед міський', 'Велосипеды горные новые'] },
  { category: 'market-auto--lehkovi-avtomobili', wrong: 'market-fashion', titles: ['Автомобіль Renault Megane', 'Автомобіль для пасіки', 'Автомобіль Toyota Corolla', 'Автомобиль Ford Focus', 'Автомобіль легковий Skoda'] },
  { category: 'processed_food', wrong: 'market-electronics', titles: ['Цукор білий мішок', 'Цукор фасований 1 кг', 'Куплю цукор оптом', 'Сахар белый мешок', 'Сахар фасованный свежий'] },
  { category: 'milk', wrong: 'market-auto', titles: ['Молоко домашнє свіже', 'Молоко коров’яче 3 л', 'Куплю молоко фермерське', 'Молоко цельное свежее', 'Молочне молоко фермерське'] },
  { category: 'market-fashion--krasa-zdorov-ya', wrong: 'market-auto', titles: ['Косметика для обличчя', 'Косметика натуральна набір', 'Продам косметику нову', 'Косметика для волосся', 'Помада декоративна нова'] },
  { category: 'market-auto--prychepy-budynky-na-kolesakh', wrong: 'market-electronics', titles: ['Причіп для пасіки', 'Причеп легковий новий', 'Куплю причіп двовісний', 'Прицеп для перевозки ульев', 'Причіп вантажний бортовий'] },
  { category: 'market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah', wrong: 'market-auto', titles: ['Медичний халат білий', 'Медичний халат жіночий', 'Медицинский халат белый', 'Медичний халат чоловічий', 'Медицинский халат новый'] },
];
const ambiguousTitles = ['Насос', 'Кабель', 'Зарядка', 'Батарея', 'Адаптер', 'Мотор', 'Насос для води', 'Кабель чорний', 'Зарядка універсальна', 'Батарея нова', 'Адаптер живлення', 'Мотор робочий', 'Насос великий', 'Кабель довгий', 'Зарядка швидка', 'Батарея потужна', 'Адаптер автомобільний', 'Мотор електричний', 'Насос промисловий', 'Кабель для дому'];

describe('category control set', () => {
  it('measures 100 distinct Ukrainian and Russian listings', async () => {
    const good = groups.flatMap(group => group.titles.map(title => ({ title, categoryId: group.category, expected: group.category })));
    const bad = groups.flatMap(group => group.titles.map(title => ({ title, categoryId: group.wrong, expected: group.category })));
    const unclear = ambiguousTitles.map(title => ({ title, categoryId: 'market-electronics', expected: null }));
    expect(new Set([...good, ...bad, ...unclear].map(item => `${item.title}|${item.categoryId}`)).size).toBe(100);
    let topThree = 0, falseWarnings = 0, falseBlocks = 0, detectedWrong = 0, blockedWrong = 0, unresolved = 0;
    const misses: string[] = [];
    for (const item of good) {
      const result = await assessCategory(item, queryable);
      if (result.suggestions.some(suggestion => suggestion.id === item.expected)) topThree++; else misses.push(item.title);
      if (result.level === 'warn') falseWarnings++;
      if (result.level === 'block') falseBlocks++;
    }
    for (const item of bad) {
      const level = (await assessCategory(item, queryable)).level;
      if (level !== 'allow') detectedWrong++; else misses.push(item.title + ' wrong');
      if (level === 'block') blockedWrong++;
    }
    for (const item of unclear) if ((await assessCategory(item, queryable)).level === 'allow') unresolved++;
    expect({ topThree, falseWarnings, falseBlocks, detectedWrong, unresolved, misses }).toEqual({ topThree: 40, falseWarnings: 0, falseBlocks: 0, detectedWrong: 40, unresolved: 19, misses: [] });
    expect(blockedWrong).toBeGreaterThan(20);
    console.info(`Step 16 control set: top3=${topThree}/40, falseWarnings=${falseWarnings}/40, falseBlocks=${falseBlocks}/40, wrongDetected=${detectedWrong}/40, wrongBlocked=${blockedWrong}/40, ambiguousUnresolved=${unresolved}/20`);
  });
  it('distinguishes the subject from context and does not block conflicting descriptions', async () => {
    const cases = [
      ['Медогонка електрична', 'market-auto', 'block'],
      ['Автомобіль для перевезення вуликів', 'market-auto--lehkovi-avtomobili', 'allow'],
      ['Медичний халат', 'honey_raw', 'block'],
      ['Мед натуральний', 'market-auto', 'block'],
      ['Автомобіль Renault', 'honey_raw', 'block'],
    ] as const;
    for (const [title, categoryId, level] of cases) expect((await assessCategory({ title, categoryId }, queryable)).level, title).toBe(level);
    expect((await assessCategory({ title: 'Автомобіль Renault', description: 'Насправді продається мед', categoryId: 'honey_raw' }, queryable)).level).toBe('warn');
  });
  it('replays the 18 independent Sol review examples', async () => {
    const cases = [
      ['Натуральний мед 3 л', 'market-auto--lehkovi-avtomobili', 'block', 'honey_raw'],
      ['Дитячий велосипед Trek', 'processed_food', 'block', 'market-hobbies--velo--velosypedy'],
      ['Автомобіль медового кольору', 'market-auto--lehkovi-avtomobili', 'allow', 'market-auto--lehkovi-avtomobili'],
      ['Електрична медогонка', 'market-business-services--prodazh-obladnannya-dlya-biznesu', 'allow', 'market-business-services--prodazh-obladnannya-dlya-biznesu'],
      ['Медичний халат', 'market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah', 'allow', 'market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah'],
      ['Причіп для перевезення вуликів', 'market-auto--prychepy-budynky-na-kolesakh', 'allow', 'market-auto--prychepy-budynky-na-kolesakh'],
      ['Насос 12 В', 'market-electronics', 'allow', null],
      ['Продаю яблука, велосипед у подарунок', 'apples', 'allow', 'apples'],
      ['Іграшковий автомобіль Toyota', 'market-children--ihrashky--ihrashkovyy-transport', 'allow', 'market-children--ihrashky--ihrashkovyy-transport'],
      ['Медичний халат для ляльки', 'market-children--ihrashky--lyalky-ta-pupsy', 'allow', 'market-children--ihrashky--lyalky-ta-pupsy'],
      ['Велосипедні рукавички Trek', 'market-fashion--aksesuary--sharfy-i-rukavychky', 'allow', 'market-fashion--aksesuary--sharfy-i-rukavychky'],
      ['Продаю яблука, дитячий велосипед Trek у подарунок', 'apples', 'allow', 'apples'],
      ['Яблука Гала 5 кг', 'market-auto--lehkovi-avtomobili', 'block', 'apples'],
      ['Смартфон Samsung Galaxy', 'honey_raw', 'block', 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony'],
      ['Диван кутовий новий', 'honey_raw', 'block', 'market-home-garden--mebli--mebli-dlya-vitalni'],
      ['Мёд липовый свежий', 'honey_raw', 'allow', 'honey_raw'],
      ['Детский велосипед Giant', 'processed_food', 'block', 'market-hobbies--velo--velosypedy'],
      ['Игрушечный автомобиль Toyota', 'market-children--ihrashky--ihrashkovyy-transport', 'allow', 'market-children--ihrashky--ihrashkovyy-transport'],
    ] as const;
    let topThree = 0, eligible = 0, falseBlocks = 0, missedBlocks = 0, falseWarnings = 0, unresolved = 0;
    for (const [title, categoryId, expected, truth] of cases) {
      const result = await assessCategory({ title, categoryId }, queryable);
      if (truth) { eligible++; if (result.suggestions.some(suggestion => suggestion.id === truth)) topThree++; }
      if (expected === 'allow' && result.level === 'block') falseBlocks++;
      if (expected === 'allow' && result.level === 'warn') falseWarnings++;
      if (expected === 'block' && result.level !== 'block') missedBlocks++;
      if (!result.suggestions.length) unresolved++;
    }
    expect({ falseBlocks, missedBlocks, falseWarnings }).toEqual({ falseBlocks: 0, missedBlocks: 0, falseWarnings: 0 });
    console.info('Step 16 Sol replay:', { topThree, eligible, falseBlocks, missedBlocks, falseWarnings, unresolved });
  });
});
