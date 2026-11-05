import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../db'
import { isBackup } from '../domain/backup'
import { importStarter, isStarterData } from '../domain/library'
import { BottomNav, Header } from '../ui'
import { BackupSection } from './BackupSection'

export function SettingsScreen() {
  const exerciseCount = useLiveQuery(() => db.exercises.count(), [])
  const planCount = useLiveQuery(() => db.programmes.where('status').equals('template').count(), [])
  const [message, setMessage] = useState('')
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  const importFile = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text())
      if (isBackup(data)) {
        setMessage("That's a backup, so nothing was changed. Use Restore from a backup for those.")
        return
      }
      if (!isStarterData(data)) throw new Error('not a plans file')
      const count = await importStarter(db, data)
      setMessage(`Loaded ${count} past plans.`)
    } catch {
      setMessage("That file couldn't be read as a plans file, so nothing was changed.")
    }
  }

  return (
    <div className="screen with-nav">
      <Header title="Settings" />
      <main className="form">
        <BackupSection />
        <section>
          <h2 className="section-title">Your past plans</h2>
          <p className="hint">
            {planCount ?? 0} past plans and {exerciseCount ?? 0} exercises on this device. Your plans aren't part of the
            public app, so a new phone needs the private plans file loaded once.
          </p>
          <label className="button">
            Load plans file
            <input
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importFile(file)
                e.target.value = ''
              }}
            />
          </label>
          {message && <p className="notice" role="status">{message}</p>}
        </section>
        <section>
          <h2 className="section-title">Storage</h2>
          <p className="hint">
            Everything stays on this device.{' '}
            {persisted === true
              ? 'The browser has agreed not to clear it.'
              : persisted === false
                ? 'Install the app to your home screen so the browser keeps your data safe.'
                : ''}
          </p>
        </section>
      </main>
      <BottomNav active="settings" />
    </div>
  )
}
