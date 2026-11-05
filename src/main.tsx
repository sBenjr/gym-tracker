import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import seed from '../seed/exercises.json'
import { App } from './App'
import { db } from './db'
import type { SeedExercise } from './domain/exercises'
import { ensureLibrary, importStarter, isStarterData } from './domain/library'
import './styles.css'

async function bootstrap() {
  await ensureLibrary(db, seed as SeedExercise[])
  // Asks the browser not to clear workout data when storage runs low.
  void navigator.storage?.persist?.()

  // On this computer only: keep the private plans loaded and up to date. Never in the public build.
  if (import.meta.env.DEV) {
    const response = await fetch('/private/starter-data.json').catch(() => null)
    const data: unknown = await response?.json().catch(() => null)
    if (isStarterData(data) && localStorage.getItem('starter-revision') !== data.revision) {
      await importStarter(db, data)
      localStorage.setItem('starter-revision', data.revision ?? '')
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
registerSW({ immediate: true })
