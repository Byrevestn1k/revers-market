export type RegistrationInput = {
    username: string
    countryCode: string
    phone: string
    password: string
    passwordConfirmation: string
}

export const countryDialCodes: Record<string, string> = {
    UA: '+380', PL: '+48', DE: '+49', CZ: '+420', SK: '+421', RO: '+40', HU: '+36',
    LT: '+370', LV: '+371', EE: '+372', MD: '+373', GB: '+44', US: '+1', CA: '+1',
}

export const countryPhoneLengths: Record<string, { min: number; max: number }> = {
    UA: { min: 9, max: 10 }, PL: { min: 9, max: 9 }, DE: { min: 10, max: 11 }, CZ: { min: 9, max: 9 },
    SK: { min: 9, max: 9 }, RO: { min: 9, max: 9 }, HU: { min: 9, max: 9 }, LT: { min: 8, max: 8 },
    LV: { min: 8, max: 8 }, EE: { min: 7, max: 8 }, MD: { min: 8, max: 8 }, GB: { min: 10, max: 10 },
    US: { min: 10, max: 10 }, CA: { min: 10, max: 10 },
}

const cleanPhone = (phone: string) => phone.trim().replace(/[()\s-]/g, '').replace(/^00/, '+')

export const normalizePhone = (countryCode: string, phone: string) => {
    const normalized = cleanPhone(phone)
    if (normalized.startsWith('+')) return normalized
    return `${countryDialCodes[countryCode] ?? ''}${normalized.replace(/^0+/, '')}`
}

export const validateRegistration = (input: Partial<RegistrationInput>): string[] => {
    const errors: string[] = []
    const username = input.username?.trim() ?? ''
    const countryCode = input.countryCode?.trim().toUpperCase() ?? ''
    const phone = cleanPhone(input.phone ?? '')
    const password = input.password ?? ''
    const dialCode = countryDialCodes[countryCode]
    const phoneLength = countryPhoneLengths[countryCode]

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) errors.push('Ім’я користувача: 3–32 символи, лише латиниця, цифри, _, ., -')
    if (!/^[A-Za-z]{2}$/.test(countryCode) || !dialCode) errors.push('Оберіть коректний код країни')
    const localPhone = phone.startsWith(dialCode ?? '') ? phone.slice((dialCode ?? '').length) : phone
    const phoneIsValid = Boolean(phoneLength
        && /^\d+$/.test(localPhone)
        && localPhone.length >= phoneLength.min
        && localPhone.length <= phoneLength.max
        && (!phone.startsWith('+') || phone.startsWith(dialCode ?? '')))
    if (!phoneIsValid) errors.push('Введіть коректний номер телефону без коду країни')
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        errors.push('Пароль: щонайменше 12 символів, велика й мала літери, цифра')
    }
    if (password !== (input.passwordConfirmation ?? '')) errors.push('Паролі не збігаються')
    return errors
}