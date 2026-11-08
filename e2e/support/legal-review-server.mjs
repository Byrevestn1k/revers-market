import { createApp } from '../../backend/dist/app.js'

// No server.ts timers and no DB operations. Tests mock API responses in Chromium.
createApp().listen(3188, '127.0.0.1')
