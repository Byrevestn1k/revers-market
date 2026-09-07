export type RegistrationInput = {
    username: string
    countryCode: string
    phone: string
    password: string
    passwordConfirmation: string
}

export const validateRegistration = (input: Partial<RegistrationInput>): string[] => {
    const errors: string[] = []
    const username = input.username?.trim() ?? ''
    const countryCode = input.countryCode?.trim().toUpperCase() ?? ''
    const phone = input.phone?.trim() ?? ''
    const password = input.password ?? ''

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) errors.push('Username: 3–32 символа, только латиница, цифры, _, ., -')
    if (!/^[A-Za-z]{2}$/.test(countryCode)) errors.push('Country code должен содержать 2 буквы')
    if (!/^\+?[1-9][0-9]{6,14}$/.test(phone)) errors.push('Введите корректный номер телефона')
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        errors.push('Пароль: минимум 12 символов, заглавная и строчная буква, цифра')
    }
    if (password !== (input.passwordConfirmation ?? '')) errors.push('Пароли не совпадают')
    return errors
}