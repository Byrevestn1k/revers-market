function App() {
    return (
        <main className="shell">
            <section className="intro" aria-labelledby="page-title">
                <p className="eyebrow">Navpaky / foundation</p>
                <h1 id="page-title">Простір для наступного кроку.</h1>
                <p className="description">
                    Мінімальний frontend-каркас уже підключений до окремого API-шару.
                    Нові клієнти та модулі можна додавати без зміни базової структури.
                </p>
                <div className="status" role="status">
                    <span className="status-dot" aria-hidden="true" />
                    Середовище готове до розробки
                </div>
            </section>
            <footer className="footer">
                <span>Frontend · React · TypeScript</span>
                <span>API · Express · TypeScript</span>
            </footer>
        </main>
    )
}

export default App
