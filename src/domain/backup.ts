import type { GymDb } from '../db'
import type { Exercise, Programme, Session, SetLog } from '../types'
import { todayIso } from './workout'

const APP = 'gym-tracker'
const LAST_BACKUP_KEY = 'lastBackupAt'
export const BACKUP_VERSION = 1
/** About a week of training at three sessions a week. */
export const BACKUP_NUDGE_AFTER = 3
/** Far more than years of training, so picking a video by mistake can't freeze the phone. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024

export const NOT_A_BACKUP = "That file isn't a Grit backup, so nothing was changed."
const DAMAGED = 'That backup looks damaged, so nothing was changed.'
const PLANS_FILE = "That's a plans file, so nothing was changed. Use Load plans file for those."
const TOO_NEW = 'That backup came from a newer version of the app. Close and reopen the app to update it, then try again.'

export interface Backup {
  app: typeof APP
  version: number
  exportedAt: number
  exercises: Exercise[]
  programmes: Programme[]
  sessions: Session[]
  sets: SetLog[]
}

export interface BackupCounts {
  workouts: number
  sets: number
  plans: number
}

/** A problem with a chosen file, with a message written for the person restoring it. */
export class BackupError extends Error {}

export function isBackup(value: unknown): boolean {
  return (value as Backup | null)?.app === APP
}

export async function createBackup(db: GymDb, now = Date.now()): Promise<Backup> {
  return db.transaction('r', db.exercises, db.programmes, db.sessions, db.sets, async () => ({
    app: APP,
    version: BACKUP_VERSION,
    exportedAt: now,
    exercises: await db.exercises.toArray(),
    programmes: await db.programmes.toArray(),
    sessions: await db.sessions.toArray(),
    sets: await db.sets.toArray(),
  }))
}

const hasStrings = (value: unknown, ...keys: string[]) =>
  typeof value === 'object' && value !== null && keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'string')

const hasList = (value: unknown, key: string) => Array.isArray((value as Record<string, unknown>)[key])

/** Checks only what every saved record must have, so a backup of real data is never turned away. */
const RECORD_CHECKS: Record<'exercises' | 'programmes' | 'sessions' | 'sets', (record: unknown) => boolean> = {
  exercises: (r) => hasStrings(r, 'id', 'name'),
  programmes: (r) => hasStrings(r, 'id', 'name', 'status') && hasList(r, 'rotation'),
  sessions: (r) => hasStrings(r, 'id', 'name', 'status') && hasList(r, 'blocks'),
  sets: (r) => hasStrings(r, 'id', 'sessionId', 'exerciseId'),
}

/** Reads a chosen file. Throws a BackupError with a plain explanation if it can't be restored. */
export function parseBackup(text: string): Backup {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError(NOT_A_BACKUP)
  }
  if (typeof data !== 'object' || data === null) throw new BackupError(NOT_A_BACKUP)
  if (data.app !== APP) throw new BackupError(Array.isArray(data.programmes) ? PLANS_FILE : NOT_A_BACKUP)
  if (typeof data.version !== 'number' || typeof data.exportedAt !== 'number') throw new BackupError(DAMAGED)
  if (data.version > BACKUP_VERSION) throw new BackupError(TOO_NEW)
  for (const [table, isValid] of Object.entries(RECORD_CHECKS)) {
    const records = data[table]
    if (!Array.isArray(records) || !records.every(isValid)) throw new BackupError(DAMAGED)
  }
  // The app always has its exercise library, so a real backup is never empty here.
  if (!(data.exercises as unknown[]).length) throw new BackupError(DAMAGED)
  return data as unknown as Backup
}

/** Replaces everything on this device. It happens fully or not at all, so a failure changes nothing. */
export async function restoreBackup(db: GymDb, backup: Backup): Promise<void> {
  // A rest timer from when the backup was made has long since run out.
  const sessions = backup.sessions.map(({ restEndsAt: _expired, ...session }) => session)
  await db.transaction('rw', [db.exercises, db.programmes, db.sessions, db.sets, db.meta], async () => {
    await db.exercises.clear()
    await db.programmes.clear()
    await db.sessions.clear()
    await db.sets.clear()
    await db.exercises.bulkAdd(backup.exercises)
    await db.programmes.bulkAdd(backup.programmes)
    await db.sessions.bulkAdd(sessions)
    await db.sets.bulkAdd(backup.sets)
    await db.meta.put({ key: LAST_BACKUP_KEY, value: backup.exportedAt })
  })
}

export async function markBackedUp(db: GymDb, at = Date.now()): Promise<void> {
  await db.meta.put({ key: LAST_BACKUP_KEY, value: at })
}

export async function lastBackupAt(db: GymDb): Promise<number | undefined> {
  return (await db.meta.get(LAST_BACKUP_KEY))?.value
}

export async function workoutsSinceBackup(db: GymDb): Promise<number> {
  const last = (await lastBackupAt(db)) ?? 0
  return db.sessions
    .where('status')
    .equals('done')
    .filter((session) => (session.finishedAt ?? 0) > last)
    .count()
}

export function countBackup({ programmes, sessions, sets }: Pick<Backup, 'programmes' | 'sessions' | 'sets'>): BackupCounts {
  return {
    workouts: sessions.filter((session) => session.status === 'done').length,
    sets: sets.length,
    plans: programmes.length,
  }
}

export async function localCounts(db: GymDb): Promise<BackupCounts> {
  return {
    workouts: await db.sessions.where('status').equals('done').count(),
    sets: await db.sets.count(),
    plans: await db.programmes.count(),
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function describeCounts({ workouts, sets, plans }: BackupCounts): string {
  return `${plural(workouts, 'workout')}, ${plural(sets, 'set')} and ${plural(plans, 'plan')}`
}

export const hasNoData = ({ workouts, sets, plans }: BackupCounts) => workouts + sets + plans === 0

export function formatBackupTime(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function backupFileName(at: number, extension = 'json', prefix = 'gym-tracker-backup'): string {
  return `${prefix}-${todayIso(new Date(at))}.${extension}`
}
