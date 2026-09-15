import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

type PasswordInputProps = InputHTMLAttributes<HTMLInputElement> & { children?: ReactNode }

/** Поле пароля з іконкою-оком, що перемикає видимість (як у референсі: око праворуч у полі). */
export default function PasswordInput({ children, className, ...rest }: PasswordInputProps) {
    const [visible, setVisible] = useState(false)
    return (
        <span className={`password-field${className ? ` ${className}` : ''}`}>
            <input {...rest} type={visible ? 'text' : 'password'} />
            <button
                type="button"
                className="password-toggle"
                aria-label={visible ? 'Сховати пароль' : 'Показати пароль'}
                title={visible ? 'Сховати пароль' : 'Показати пароль'}
                onClick={() => setVisible((current) => !current)}
            >
                {visible ? (
                    // око перекреслене
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                ) : (
                    // око
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                )}
            </button>
            {children}
        </span>
    )
}
