import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
    plugins: [react()],
    server: {
        host: '127.0.0.1',
        port: 5173,
        proxy: {
            '/api': { target: backendUrl, changeOrigin: true },
            '/uploads': { target: backendUrl, changeOrigin: true },
        },
    },
})
