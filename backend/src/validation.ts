export type RegistrationInput = {
    username: string
    email: string
    countryCode: string
    phone: string
    password: string
    passwordConfirmation: string
}

export const countryDialCodes: Record<string, string> = {
    UA: '+380', PL: '+48', DE: '+49', CZ: '+420', SK: '+421', RO: '+40', HU: '+36',
    LT: '+370', LV: '+371', EE: '+372', MD: '+373', GB: '+44', US: '+1', CA: '+1',
    FR: '+33', IT: '+39', ES: '+34', PT: '+351', AT: '+43', NL: '+31', BE: '+32',
    BG: '+359', HR: '+385', GR: '+30', DK: '+45', FI: '+358', IE: '+353', SE: '+46',
    NO: '+47', CH: '+41', TR: '+90', GE: '+995', AM: '+374', AZ: '+994', KZ: '+7',
    IL: '+972', AE: '+971', BY: '+375',
}

export const countryPhoneLengths: Record<string, { min: number; max: number }> = {
    UA: { min: 9, max: 10 }, PL: { min: 9, max: 9 }, DE: { min: 10, max: 11 }, CZ: { min: 9, max: 9 },
    SK: { min: 9, max: 9 }, RO: { min: 9, max: 9 }, HU: { min: 9, max: 9 }, LT: { min: 8, max: 8 },
    LV: { min: 8, max: 8 }, EE: { min: 7, max: 8 }, MD: { min: 8, max: 8 }, GB: { min: 10, max: 10 },
    US: { min: 10, max: 10 }, CA: { min: 10, max: 10 },
    FR: { min: 9, max: 9 }, IT: { min: 9, max: 10 }, ES: { min: 9, max: 9 }, PT: { min: 9, max: 9 },
    AT: { min: 10, max: 11 }, NL: { min: 9, max: 9 }, BE: { min: 8, max: 9 }, BG: { min: 8, max: 9 },
    HR: { min: 8, max: 9 }, GR: { min: 10, max: 10 }, DK: { min: 8, max: 8 }, FI: { min: 6, max: 12 },
    IE: { min: 7, max: 9 }, SE: { min: 7, max: 13 }, NO: { min: 8, max: 8 }, CH: { min: 9, max: 9 },
    TR: { min: 10, max: 10 }, GE: { min: 9, max: 9 }, AM: { min: 8, max: 8 }, AZ: { min: 9, max: 9 },
    KZ: { min: 10, max: 10 }, IL: { min: 8, max: 9 }, AE: { min: 9, max: 9 }, BY: { min: 9, max: 9 },
}

const cleanPhone = (phone: string) => phone.trim().replace(/[()\s-]/g, '').replace(/^00/, '+')

export const normalizePhone = (countryCode: string, phone: string) => {
    const normalized = cleanPhone(phone)
    if (normalized.startsWith('+')) return normalized
    return `${countryDialCodes[countryCode] ?? ''}${normalized.replace(/^0+/, '')}`
}

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const isValidEmail = (email: string) => email.length <= 254 && emailPattern.test(email)

export const passwordError = (password: string) => password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)
    ? 'Пароль: щонайменше 12 символів, велика й мала літери, цифра'
    : null

export const isValidPhone = (countryCode: string, phone: string) => {
    const code = countryCode.trim().toUpperCase()
    const dialCode = countryDialCodes[code]
    const length = countryPhoneLengths[code]
    const cleaned = cleanPhone(phone)
    const local = cleaned.startsWith(dialCode ?? '') ? cleaned.slice((dialCode ?? '').length) : cleaned
    return Boolean(dialCode && length && /^\d+$/.test(local) && local.length >= length.min && local.length <= length.max && (!cleaned.startsWith('+') || cleaned.startsWith(dialCode)))
}

export const validateRegistration = (input: Partial<RegistrationInput>): string[] => {
    const errors: string[] = []
    const username = input.username?.trim() ?? ''
    const countryCode = input.countryCode?.trim().toUpperCase() ?? ''
    const phone = cleanPhone(input.phone ?? '')
    const password = input.password ?? ''
    const dialCode = countryDialCodes[countryCode]
    const phoneLength = countryPhoneLengths[countryCode]

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) errors.push('Логін: 3–32 символи, лише латиниця, цифри, _, ., -')
    const email = input.email?.trim() ?? ''
    if (!isValidEmail(email)) errors.push('Введіть коректну електронну пошту')
    if (!/^[A-Za-z]{2}$/.test(countryCode) || !dialCode) errors.push('Оберіть коректний код країни')
    const localPhone = phone.startsWith(dialCode ?? '') ? phone.slice((dialCode ?? '').length) : phone
    const phoneIsValid = Boolean(phoneLength
        && /^\d+$/.test(localPhone)
        && localPhone.length >= phoneLength.min
        && localPhone.length <= phoneLength.max
        && (!phone.startsWith('+') || phone.startsWith(dialCode ?? '')))
    if (!phoneIsValid) errors.push('Введіть коректний номер телефону без коду країни')
    const passwordValidationError = passwordError(password)
    if (passwordValidationError) errors.push(passwordValidationError)
    if (password !== (input.passwordConfirmation ?? '')) errors.push('Паролі не збігаються')
    return errors
}
