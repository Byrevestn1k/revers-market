/**
 * Довідник країн для поля телефону.
 * Список країн (назва, ISO-код, телефонний код) підтягується з безкоштовного API countriesnow.space,
 * прапорці — PNG-картинки з flagcdn.com (emoji-прапорці Windows не малює).
 * Локальна база нижче — фолбек і джерело допустимої довжини номера.
 */
export type Country = { code: string; name: string; dial: string; min: number; max: number }

export const flagUrl = (code: string, size = 'w40') => `https://flagcdn.com/${size}/${code.toLowerCase()}.png`

const c = (code: string, name: string, dial: string, min: number, max = min): Country => ({ code, name, dial, min, max })

/** Локальний фолбек + довжини національних номерів (без коду країни). */

export const COUNTRIES: Country[] = [
    c('UA', 'Україна', '380', 9),
    c('PL', 'Польща', '48', 9),
    c('DE', 'Німеччина', '49', 10, 11),
    c('CZ', 'Чехія', '420', 9),
    c('SK', 'Словаччина', '421', 9),
    c('RO', 'Румунія', '40', 9),
    c('HU', 'Угорщина', '36', 9),
    c('LT', 'Литва', '370', 8),
    c('LV', 'Латвія', '371', 8),
    c('EE', 'Естонія', '372', 7, 8),
    c('MD', 'Молдова', '373', 8),
    c('GB', 'Велика Британія', '44', 10),
    c('US', 'США', '1', 10),
    c('CA', 'Канада', '1', 10),
    c('FR', 'Франція', '33', 9),
    c('IT', 'Італія', '39', 9, 10),
    c('ES', 'Іспанія', '34', 9),
    c('PT', 'Португалія', '351', 9),
    c('AT', 'Австрія', '43', 10, 11),
    c('NL', 'Нідерланди', '31', 9),
    c('BE', 'Бельгія', '32', 8, 9),
    c('BG', 'Болгарія', '359', 8, 9),
    c('HR', 'Хорватія', '385', 8, 9),
    c('GR', 'Греція', '30', 10),
    c('DK', 'Данія', '45', 8),
    c('FI', 'Фінляндія', '358', 6, 12),
    c('IE', 'Ірландія', '353', 7, 9),
    c('SE', 'Швеція', '46', 7, 13),
    c('NO', 'Норвегія', '47', 8),
    c('CH', 'Швейцарія', '41', 9),
    c('TR', 'Туреччина', '90', 10),
    c('GE', 'Грузія', '995', 9),
    c('AM', 'Вірменія', '374', 8),
    c('AZ', 'Азербайджан', '994', 9),
    c('KZ', 'Казахстан', '7', 10),
    c('IL', 'Ізраїль', '972', 8, 9),
    c('AE', 'ОАЕ', '971', 9),
    c('BY', 'Білорусь', '375', 9),
]

export const digitsOf = (value: string) => value.replace(/\D/g, '')

/** Маска (97)-744-44-44: ведучий нуль прибирається, дужки та риски не зникають під час введення. */
export const formatPhone = (value: string) => {
    const d = digitsOf(value).replace(/^0+/, '')
    if (!d.length) return ''
    let out = `(${d.slice(0, 2)}`
    if (d.length >= 2) out += ')-'
    if (d.length > 2) out += d.slice(2, 5)
    if (d.length >= 5) out += '-'
    if (d.length > 5) out += d.slice(5, 7)
    if (d.length >= 7) out += '-'
    if (d.length > 7) out += d.slice(7, 9)
    if (d.length > 9) out += d.slice(9, 13)
    return out
}

export const findCountry = (code: string, list: Country[] = COUNTRIES) =>
    list.find((country) => country.code === code?.toUpperCase())

type CodeEntry = { name?: string; code?: string; dial_code?: string }

/** Довжини національних номерів для країн поза фолбеком. */
const EXTRA_LENGTHS: Record<string, { min: number; max: number }> = {
    BR: { min: 10, max: 11 }, CN: { min: 9, max: 11 }, JP: { min: 9, max: 10 }, IN: { min: 10, max: 10 },
    KR: { min: 9, max: 10 }, VN: { min: 9, max: 10 }, TH: { min: 9, max: 9 }, ID: { min: 9, max: 12 },
    MX: { min: 10, max: 10 }, AR: { min: 10, max: 11 }, AU: { min: 9, max: 9 }, NZ: { min: 8, max: 10 },
    RS: { min: 8, max: 9 }, BA: { min: 8, max: 8 }, MK: { min: 8, max: 8 }, AL: { min: 8, max: 9 },
    SI: { min: 8, max: 8 }, ME: { min: 8, max: 8 }, UZ: { min: 9, max: 9 }, KG: { min: 9, max: 9 },
    TJ: { min: 9, max: 9 }, TM: { min: 8, max: 8 }, HK: { min: 8, max: 8 }, SG: { min: 8, max: 8 },
    MY: { min: 9, max: 10 }, PH: { min: 10, max: 10 }, PK: { min: 10, max: 10 }, EG: { min: 9, max: 10 },
    MA: { min: 9, max: 9 }, ZA: { min: 9, max: 9 }, NG: { min: 10, max: 10 }, KE: { min: 9, max: 9 },
}
const lengthOf = (code: string) => {
    const local = findCountry(code)
    if (local) return { min: local.min, max: local.max }
    return EXTRA_LENGTHS[code] ?? { min: 7, max: 15 }
}

/** Завантажує повний довідник країн (~242) з countriesnow.space, зливає з локальними довжинами; при помилці — фолбек. */
export const loadCountries = async (): Promise<Country[]> => {
    try {
        const response = await fetch('https://countriesnow.space/api/v0.1/countries/codes')
        if (!response.ok) throw new Error(String(response.status))
        const payload = await response.json() as { data?: CodeEntry[] }
        const merged = (payload.data ?? [])
            .filter((item) => item.code && item.dial_code)
            .map((item): Country => ({
                code: item.code as string,
                name: item.name ?? (item.code as string),
                dial: (item.dial_code as string).replace(/^\+/, ''),
                ...lengthOf(item.code as string),
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
        return merged.length ? merged : COUNTRIES
    } catch {
        return COUNTRIES
    }
}
