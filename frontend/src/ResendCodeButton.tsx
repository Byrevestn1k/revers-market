import { useEffect, useState } from 'react'

export default function ResendCodeButton({ onResend }: { onResend: () => Promise<void> }) {
    const [seconds, setSeconds] = useState(60)
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (seconds === 0) return
        const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000)
        return () => window.clearTimeout(timer)
    }, [seconds])
    const resend = async () => {
        setBusy(true)
        try { await onResend(); setSeconds(60) } finally { setBusy(false) }
    }
    return <button type="button" className="text-button resend-code-button" disabled={busy || seconds > 0} onClick={resend}>
        {seconds > 0 ? `Надіслати повторно (${seconds} с)` : 'Надіслати повторно'}
    </button>
}
