// Browser QA entry point; not included in the production build.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { PushSettings } from './src/push-notifications'

createRoot(document.getElementById('root')!).render(React.createElement(PushSettings, { userId: 'user-a' }))
