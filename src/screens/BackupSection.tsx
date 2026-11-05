import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { canSendFiles, downloadBackup, sendBackup } from '../backupFile'
import { db } from '../db'
import {
  BACKUP_NUDGE_AFTER,
  BackupError,
  countBackup,
  createBackup,
  describeCounts,
  formatBackupTime,
  hasNoData,
  lastBackupAt,
  localCounts,
  markBackedUp,
  MAX_BACKUP_BYTES,
  NOT_A_BACKUP,
  parseBackup,
  restoreBackup,
  workoutsSinceBackup,
  type Backup,
} from '../domain/backup'
import { navigate } from '../router'
import { ConfirmButton } from '../ui'

/** A quiet prompt on Today once enough workouts have built up without a backup. */
export function BackupNudge() {
  const since = useLiveQuery(() => workoutsSinceBackup(db), [])
  if (since === undefined || since < BACKUP_NUDGE_AFTER) return null
  return (
    <button type="button" className="backup-nudge" onClick={() => navigate('/settings')}>
      <span>{since} workouts not backed up</span>
      <span className="backup-nudge-action">Back up</span>
    </button>
  )
}

export function BackupSection() {
  const status = useLiveQuery(
    async () => ({
      last: await lastBackupAt(db),
      since: await workoutsSinceBackup(db),
      counts: await localCounts(db),
    }),
    [],
  )
  const [canSend] = useState(canSendFiles)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<Backup | null>(null)

  const backUp = async (save: (backup: Backup) => Promise<'sent' | 'downloaded' | 'cancelled'>) => {
    try {
      const backup = await createBackup(db)
      const result = await save(backup)
      if (result === 'cancelled') {
        setMessage('Backup cancelled, so nothing was saved.')
        return
      }
      await markBackedUp(db, backup.exportedAt)
      setMessage(
        result === 'sent'
          ? 'Backup sent. Check it arrived in the app you chose.'
          : "Backup saved to this device's Downloads. Copy it to Google Drive or email it to yourself, so it's safe if you lose this device.",
      )
    } catch {
      setMessage("The backup couldn't be made. Please try again.")
    }
  }

  const chooseFile = async (file: File) => {
    setPending(null)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new BackupError(NOT_A_BACKUP)
      setPending(parseBackup(await file.text()))
      setMessage('')
    } catch (error) {
      setMessage(error instanceof BackupError ? error.message : NOT_A_BACKUP)
    }
  }

  const restore = async (backup: Backup) => {
    try {
      const current = await createBackup(db)
      const keepCopy = !hasNoData(countBackup(current))
      if (keepCopy) downloadBackup(current, 'gym-tracker-before-restore')
      await restoreBackup(db, backup)
      setPending(null)
      setMessage(
        `Restored ${describeCounts(countBackup(backup))}.` +
          (keepCopy ? ' A copy of what was on this device was saved to your Downloads first.' : ''),
      )
    } catch {
      setPending(null)
      setMessage("The restore didn't work, so your data on this device wasn't replaced.")
    }
  }

  return (
    <section>
      <h2 className="section-title">Backup</h2>
      <p className="hint">
        {status?.last ? `Last backup: ${formatBackupTime(status.last)}.` : 'Not backed up yet.'}
        {status?.last && status.since > 0 ? ` ${status.since} workout${status.since === 1 ? '' : 's'} since then.` : ''}{' '}
        {status ? `This device has ${describeCounts(status.counts)}.` : ''}
      </p>
      <div className="backup-actions">
        <button type="button" className="button primary" onClick={() => void backUp(sendBackup)}>
          Back up now
        </button>
        <p className="hint">
          {canSend
            ? "Sends a file to Google Drive, email or another app, so it's safe if you lose this phone. It holds your training history, so keep it private."
            : "Saves a file to this device's Downloads. It holds your training history, so keep it private."}
        </p>
        {canSend && (
          <button
            type="button"
            className="button"
            onClick={() =>
              void backUp(async (backup) => {
                downloadBackup(backup)
                return 'downloaded'
              })
            }
          >
            Save to this phone instead
          </button>
        )}
        <label className="button">
          Restore from a backup
          {/* No file type filter: phones can grey out a real backup, and the check below explains any wrong file. */}
          <input
            type="file"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void chooseFile(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {pending && status && (
        <div className="notice" role="group" aria-label="Restore this backup?">
          <strong>Backup from {formatBackupTime(pending.exportedAt)}</strong>
          <span>In the backup: {describeCounts(countBackup(pending))}.</span>
          <span>On this device now: {describeCounts(status.counts)}.</span>
          <span>
            Restoring replaces everything on this device.
            {hasNoData(status.counts) ? '' : " A copy of what's here now will be saved to your Downloads first."}
          </span>
          <ConfirmButton
            label="Replace everything on this device"
            confirmLabel="Tap again to replace"
            onConfirm={() => void restore(pending)}
          />
          <button type="button" className="button" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
