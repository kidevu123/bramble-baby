import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/global.css'
import { clearNotificationsOnOpen } from './lib/push'
import { startUpdateWatch } from './lib/update'
import { captureLogHandoff } from './lib/nudges'

startUpdateWatch()
// Opening Bramble takes its delivered notifications off the lock screen: what they said is in the app.
clearNotificationsOnOpen()
// A tapped push arrives as `/?log=<kind>`: taken off the address before the router sees it, Home opens that sheet.
captureLogHandoff()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
