import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/global.css'
import { startUpdateWatch } from './lib/update'
import { captureLogHandoff } from './lib/nudges'

startUpdateWatch()
// A tapped push arrives as `/?log=<kind>`: taken off the address before the router sees it, Home opens that sheet.
captureLogHandoff()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
