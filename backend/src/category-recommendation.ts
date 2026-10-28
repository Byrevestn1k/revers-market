import type { PoolClient } from 'pg';
import type { RequestHandler } from 'express';
import { pool } from './db/client.js';
import { searchTokens } from './smart-search.js';

type Queryable = Pick<PoolClient, 'query'>;
type Category = { id: string; parent_id: string | null; code: string; name: string };
export type CategorySuggestion = { id: string; name: string; path: string };
export type CategoryAssessment = { level: 'allow' | 'warn' | 'block'; certainty: 'identified' | 'uncertain'; reason: string | null; suggestions: CategorySuggestion[] };

// Resolve the offered item before words naming its purpose, compatibility or a gift.
const subjects = [
  { pattern: /(?:^|\s)(?:медичн\S*|медицинск\S*)\s+халат\S*\s+для\s+(?:ляльк\S*|кукл\S*)(?=\s|$)/u, codes: ['market-children--ihrashky--lyalky-ta-pupsy'], family: 'doll_item' },
  { pattern: /(?:^|\s)(?:одяг\S*|одежд\S*|халат\S*)\s+для\s+(?:ляльк\S*|кукл\S*)(?=\s|$)/u, codes: ['market-children--ihrashky--lyalky-ta-pupsy'], family: 'doll_item' },
  { pattern: /(?:^|\s)(?:(?:іграшков\S*|игрушечн\S*)\s+(?:автомобіл\S*|автомобил\S*|машин\S*|авто)|(?:масштабн\S*\s+)?модел\S*\s+(?:автомобіл\S*|автомобил\S*))(?=\s|$)/u, codes: ['market-children--ihrashky--ihrashkovyy-transport'], family: 'toy_vehicle' },
  { pattern: /(?:^|\s)(?:(?:велосипедн\S*\s+)?(?:рукавичк\S*|перчатк\S*))(?:\s+для\s+велосипед\S*)?(?=\s|$)/u, codes: ['market-fashion--aksesuary--sharfy-i-rukavychky'], family: 'gloves' },
  { pattern: /(?:^|\s)(?:малюнок|рисунок|картина)\s+(?:автомобіл\S*|автомобил\S*|машин\S*)(?=\s|$)/u, codes: ['market-hobbies'], family: 'art' },
  { pattern: /(?:^|\s)(?:чох(?:ол|л)\S*|чех(?:ол|л)\S*)\s+автомоб\S*(?=\s|$)/u, codes: ['market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky'], family: 'accessory' },
  { pattern: /(?:^|\s)(?:обладнанн\S*|оборудован\S*|насос\S*)\s+для\s+(?:(?:фасуванн\S*|фасовк\S*)\s+)?(?:меду|меда|бджільництв\S*|пчеловодств\S*)(?=\s|$)/u, codes: ['market-business-services--prodazh-obladnannya-dlya-biznesu--promyslove-obladnannya', 'market-business-services--prodazh-obladnannya-dlya-biznesu'], family: 'equipment' },
  { pattern: /(?:^|\s)(?:медогонк\S*|медогон\S*|honey\s+extractor)(?=\s|$)/u, codes: ['market-business-services--prodazh-obladnannya-dlya-biznesu'], family: 'equipment' },
  { pattern: /(?:^|\s)(?:медичн\S*|медицинск\S*)\s+халат\S*(?=\s|$)/u, codes: ['market-fashion--spetsodyah-spetsvzuttya-ta-aksesuary--medychnyy-odyah'], family: 'clothes' },
  { pattern: /(?:^|\s)(?:причеп\S*|причіп\S*|прицеп\S*)(?=\s|$)/u, codes: ['market-auto--prychepy-budynky-na-kolesakh'], family: 'vehicle' },
  { pattern: /(?:^|\s)(?:автомобіл\S*|автомобил\S*|легков\S*\s+авто|renault\s+megane)(?=\s|$)/u, codes: ['market-auto--lehkovi-avtomobili'], family: 'vehicle' },
  { pattern: /(?:^|\s)(?:велосипед\S*|велосипєд\S*)(?=\s|$)/u, codes: ['market-hobbies--velo--velosypedy'], family: 'bike' },
  { pattern: /(?:^|\s)(?:яблук\S*|яблок\S*)(?=\s|$)/u, codes: ['apples'], family: 'apple' },
  { pattern: /(?:^|\s)(?:смартфон\S*|smartphone\S*|мобільн\S*\s+телефон\S*|мобильн\S*\s+телефон\S*)(?=\s|$)/u, codes: ['market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony'], family: 'smartphone' },
  { pattern: /(?:^|\s)(?:диван\S*|софа\S*)(?=\s|$)/u, codes: ['market-home-garden--mebli--mebli-dlya-vitalni'], family: 'sofa' },
  { pattern: /(?:^|\s)(?:мед|меду|мёд|меда|мёда)(?=\s|$)/u, codes: ['apiculture'], family: 'food' },
  { pattern: /(?:^|\s)(?:пилок|пилку|перг\S*|прополіс\S*|прополис\S*|(?:бджолин\S*|пчелин\S*)\s+(?:віск\S*|воск\S*)|маточн\S*\s+молоч\S*)(?=\s|$)/u, codes: ['apiculture'], family: 'bee_products' },
  { pattern: /(?:^|\s)(?:цукор\S*|сахар\S*)(?=\s|$)/u, codes: ['processed_food'], family: 'food' },
  { pattern: /(?:^|\s)(?:молок\S*|молочн\S*)(?=\s|$)/u, codes: ['milk'], family: 'food' },
  { pattern: /(?:^|\s)(?:косметик\S*|помад\S*)(?=\s|$)/u, codes: ['market-fashion--krasa-zdorov-ya'], family: 'cosmetics' },
  { pattern: /(?:^|\s)(?:вулик\S*|вуликів|уль\S*|бджолин\S*\s+рамк\S*|пчелин\S*\s+рамк\S*)(?=\s|$)/u, codes: ['market-business-services--prodazh-obladnannya-dlya-biznesu'], family: 'beekeeping' },
] as const;

const confirmingContext: Record<string, RegExp> = {
  food: /(?:натурал\S*|акаці\S*|липов\S*|гречан\S*|пасік\S*|відр\S*|ведр\S*|білий|белый|мішок|мешок|фасован\S*|свіж\S*|свеж\S*|коров\S*|фермер\S*|домашн\S*|оптом|куплю|продам|\d+\s*(?:л|кг))/u,
  bee_products: /(?:пилок|пилку|перг\S*|прополіс\S*|прополис\S*|бджолин\S*|пчелин\S*|маточн\S*)/u,
  bike: /(?:trek|giant|scott|гірськ\S*|горн\S*|дитяч\S*|детск\S*|міськ\S*|городск\S*|електро\S*)/u,
  vehicle: /(?:renault|toyota|ford|skoda|megane|легков\S*|двовіс\S*|двухос\S*|бортов\S*|вантажн\S*|перевез\S*|перевоз\S*|пасік\S*)/u,
  clothes: /(?:медичн\S*\s+халат\S*|медицинск\S*\s+халат\S*)/u,
  cosmetics: /(?:обличч\S*|волосс\S*|декоратив\S*|набір|набор|помада)/u,
  equipment: /(?:електричн\S*|электрическ\S*|фасуван\S*|фасовк\S*|бджільництв\S*|пчеловодств\S*)/u,
  accessory: /(?:автомоб\S*|авто)/u,
  beekeeping: /(?:дадан\S*|бджол\S*|пчел\S*|пасік\S*)/u,
  apple: /(?:гала|голден|сорт\S*|кг|врожай|урожай|свіж\S*|свеж\S*)/u,
  smartphone: /(?:samsung|iphone|galaxy|xiaomi|pixel|телефон\S*|s\s*2\d)/u,
  sofa: /(?:кутов\S*|углов\S*|розкладн\S*|раскладн\S*|новий|новый|мебл\S*)/u,
};
const normalize = (text: string) => text.toLocaleLowerCase('uk-UA').replace(/[’ʼ`´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

type Subject = { readonly codes: readonly string[]; readonly family: string };
type SubjectResolution = { subject?: Subject; head: string; hardEvidence: boolean; conflict: boolean };
const purposeMarker = /\s+(?:для|до|під|под|на)\s+/u;
const bundleMarker = /\s+(?:із|з|с|со)\s+(?:комплектом|набором|комплектом\s+із|набором\s+из)\s+/u;
const carTarget = /(?:автомоб\S*|авто|машин\S*|toyota|renault|ford|skoda|bmw|mercedes)/u;
const bikeTarget = /(?:велосипед\S*|велосипєд\S*|велобайк\S*)/u;
const phoneTarget = /(?:телефон\S*|смартфон\S*|iphone)/u;
const laptopTarget = /(?:ноутбук\S*|ноутбуков\S*|ноут\S*)/u;
const tractorTarget = /(?:трактор\S*|сільгосптехнік\S*|сельхозтехник\S*)/u;
// The left noun is the item for sale; the right noun only narrows compatibility.
// These codes are existing category nodes, never new catalog entries.
const relationalSubjects: { head: RegExp; target: RegExp; codes: readonly string[]; family: string }[] = [
  { head: /(?:чох(?:ол|л)\S*|чех(?:ол|л)\S*)/u, target: carTarget, codes: ['market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky'], family: 'accessory' },
  { head: /(?:чох(?:ол|л)\S*|чех(?:ол|л)\S*)/u, target: phoneTarget, codes: ['market-electronics--telefony-ta-aksesuary--aksesuary-dlya-telefoniv'], family: 'accessory' },
  { head: /(?:килимк\S*|коврик\S*)/u, target: carTarget, codes: ['market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky'], family: 'accessory' },
  { head: /фар\S*/u, target: carTarget, codes: ['market-auto-parts--avtozapchastyny--fary-ta-osvitlennya'], family: 'part' },
  { head: /(?:запчаст\S*|детал\S*|частин\S*)/u, target: tractorTarget, codes: ['market-auto-parts--zapchastyny-dlya-silhosptekhniky'], family: 'part' },
  { head: /(?:запчаст\S*|детал\S*|частин\S*)/u, target: carTarget, codes: ['market-auto-parts--avtozapchastyny'], family: 'part' },
  { head: /(?:запчаст\S*|детал\S*|частин\S*)/u, target: bikeTarget, codes: ['market-hobbies--velo--veloaksesuary'], family: 'part' },
  { head: /(?:сумк\S*|сумочк\S*|сумка\S*)/u, target: laptopTarget, codes: ['market-electronics--noutbuky-ta-aksesuary--aksesuary-dlya-noutbukiv'], family: 'accessory' },
  { head: /(?:сумк\S*|сумочк\S*|сумка\S*)/u, target: bikeTarget, codes: ['market-hobbies--velo--veloaksesuary'], family: 'accessory' },
  { head: /(?:зарядн\S*|зарядк\S*|зарядочн\S*)/u, target: carTarget, codes: ['market-auto-parts--aksesuary-dlya-avto--puskovi-ta-zaryadni-prystroyi'], family: 'accessory' },
  { head: /(?:корм\S*|корма\S*)/u, target: /(?:собак\S*|пес\S*|пс\S*)/u, codes: ['market-animals--zootovary--tovary-dlya-sobak'], family: 'animal_supply' },
  { head: /(?:кабел\S*|кабель\S*|провод\S*)/u, target: /(?:сонячн\S*|солнечн\S*|solar)/u, codes: ['market-electronics--aksesuary-y-komplektuyuchi'], family: 'accessory' },
  { head: /рамк\S*/u, target: /(?:вулик\S*|вуликів|уль\S*)/u, codes: ['market-business-services--prodazh-obladnannya-dlya-biznesu'], family: 'beekeeping' },
];

const giftMarker = /\s+(?:у|в)\s+(?:подарунок|подарок)(?:\s|$)/u;
function primaryText(text: string) {
  const giftAt = text.search(giftMarker);
  if (giftAt < 0) return text;
  const before = text.slice(0, giftAt);
  const separators = [',', ';', '+', ' та ', ' і ', ' и ', ' з ', ' с '];
  const positions = separators.map(separator => before.lastIndexOf(separator));
  return before.slice(0, Math.max(...positions, 0)).trim() || before.trim();
}
function subjectMatches(text: string) {
  return subjects.map(subject => {
    const match = subject.pattern.exec(text);
    return { subject, index: match?.index ?? -1, end: match ? match.index + match[0].length : -1 };
  })
    .filter(match => match.index >= 0).sort((a, b) => a.index - b.index);
}

function resolveSubject(rawTitle: string): SubjectResolution {
  const core = normalize(primaryText(rawTitle.toLocaleLowerCase('uk-UA')));
  const purpose = purposeMarker.exec(core);
  const bundle = bundleMarker.exec(core);
  const cut = Math.min(purpose?.index ?? core.length, bundle?.index ?? core.length);
  const head = core.slice(0, cut).trim();
  const target = purpose ? core.slice(purpose.index + purpose[0].length) : '';
  const headMatches = subjectMatches(head);
  const first = headMatches[0];
  const conflictingHeads = first ? headMatches.some(match => match.index >= first.end && match.subject.family !== first.subject.family) : false;
  if (purpose && /(?:^|\s)(?:ляльк\S*|кукл\S*)(?=\s|$)/u.test(target) && head)
    return { subject: { codes: ['market-children--ihrashky--lyalky-ta-pupsy', 'market-children--ihrashky--aksesuary-dlya-lyalok-ta-pupsiv'], family: 'doll_item' }, head, hardEvidence: false, conflict: false };
  if (purpose) {
    const equipment = subjectMatches(core).find(match => match.subject.family === 'equipment' && match.index < purpose.index);
    if (equipment) return { subject: equipment.subject, head, hardEvidence: true, conflict: false };
    const related = relationalSubjects.find(rule => rule.head.test(head) && rule.target.test(target));
    if (related) return { subject: related, head, hardEvidence: false, conflict: false };
  }
  if (/(?:^|\s)(?:іграшков\S*|игрушечн\S*)(?=\s|$)/u.test(head) && !headMatches.length)
    return { subject: { codes: ['market-children--ihrashky'], family: 'toy' }, head, hardEvidence: false, conflict: false };
  return { subject: headMatches[0]?.subject, head, hardEvidence: Boolean(headMatches.length), conflict: conflictingHeads };
}

let categoryCache: { expires: number; items: Category[] } | null = null;
async function categories(queryable: Queryable): Promise<Category[]> {
  if (categoryCache && categoryCache.expires > Date.now()) return categoryCache.items;
  const result = await queryable.query<Category>('SELECT id, parent_id, code, name FROM categories WHERE is_active');
  categoryCache = { expires: Date.now() + 60_000, items: result.rows };
  return result.rows;
}

export async function assessCategory(input: { title: string; description?: string; categoryId?: string; unit?: string }, queryable: Queryable = pool): Promise<CategoryAssessment> {
  const items = await categories(queryable);
  const byCode = new Map(items.map(item => [item.code, item]));
  const byId = new Map(items.map(item => [item.id, item]));
  const description = normalize((input.description ?? '').slice(0, 5000));
  const resolution = resolveSubject(input.title.slice(0, 160));
  const core = normalize(primaryText(input.title.slice(0, 160).toLocaleLowerCase('uk-UA')));
  const subject = resolution.subject;
  const descriptiveSubject = giftMarker.test(description) ? undefined : resolveSubject((input.description ?? '').slice(0, 5000)).subject;
  const detected = subject ?? descriptiveSubject;
  const conflict = Boolean(resolution.conflict || subject && descriptiveSubject && subject.family !== descriptiveSubject.family);
  const confirmedDirect = Boolean(subject && resolution.hardEvidence && core.split(' ').length >= 2 && confirmingContext[subject.family]?.test(core + ' ' + description));
  const knownSubjectCategory = Boolean(detected?.codes.some(code => byCode.has(code)));
  const certainty = subject && !conflict && knownSubjectCategory && (!resolution.hardEvidence || confirmedDirect) ? 'identified' : 'uncertain';
  const chosen = input.categoryId ? byId.get(input.categoryId) : undefined;
  const path = (category: Category) => {
    const trail = [category.name];
    let parent = category.parent_id ? byId.get(category.parent_id) : undefined;
    while (parent && trail.length < 8) { trail.unshift(parent.name); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined; }
    return trail.join(' › ');
  };
  const categoryCandidates = detected?.codes.map(code => byCode.get(code)).filter((item): item is Category => Boolean(item)) ?? [];
  if (!categoryCandidates.length) {
    const words = searchTokens(resolution.head || input.title).filter(word => word.length >= 4);
    categoryCandidates.push(...items.map(item => {
      const name = normalize(item.name);
      const score = words.reduce((total, word) => total + (name.split(' ').some(part => part.length >= 4 && part.slice(0, 5) === word.slice(0, 5)) ? 1 : 0), 0);
      return { item, score };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'uk')).slice(0, 3).map(row => row.item));
  }
  const suggestions = categoryCandidates
    .map(item => ({ id: item.id, name: item.name, path: path(item) })).slice(0, 3);
  if (!chosen || !detected || !suggestions.length) return { level: 'allow', certainty, reason: null, suggestions };
  const acceptable = detected.codes.some(code => {
    const target = byCode.get(code);
    if (!target) return false;
    if ((detected.family === 'equipment' || detected.family === 'beekeeping') && chosen.code === 'apiculture') return false;
    let current: Category | undefined = chosen;
    while (current) { if (current.id === target.id) return true; current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    current = target;
    while (current) { if (current.id === chosen.id) return true; current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    return false;
  });
  if (acceptable) return { level: 'allow', certainty, reason: null, suggestions };
  // Semantic evidence recommends and warns. It never makes a hard publishing decision.
  return { level: 'warn', certainty, reason: 'Можливо, для цього оголошення більше підходить інша категорія.', suggestions };
}

export function createCategoryRecommendationRateLimit(): RequestHandler {
  const entries = new Map<string, { count: number; until: number }>();
  return (request, response, next) => {
    const now = Date.now();
    if (entries.size > 10_000) for (const [key, value] of entries) if (value.until <= now) entries.delete(key);
    const key = request.authUser?.id ?? request.socket.remoteAddress ?? 'unknown';
    const current = entries.get(key);
    if (!current && entries.size >= 10_000) { response.status(429).json({ error: 'CATEGORY_RATE_LIMIT' }); return; }
    const entry = current && current.until > now ? current : { count: 0, until: now + 60_000 };
    if (entry.count >= 60) { response.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000))); response.status(429).json({ error: 'CATEGORY_RATE_LIMIT' }); return; }
    entry.count++;
    entries.set(key, entry);
    next();
  };
}
