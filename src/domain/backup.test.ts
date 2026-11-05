import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { GymDb } from '../db'
import type { Session, SetLog } from '../types'
import {
  BACKUP_VERSION,
  backupFileName,
  BackupError,
  countBackup,
  createBackup,
  describeCounts,
  hasNoData,
  isBackup,
  lastBackupAt,
  localCounts,
  markBackedUp,
  NOT_A_BACKUP,
  parseBackup,
  restoreBackup,
  workoutsSinceBackup,
  type Backup,
} from './backup'
import { newExercise } from './exercises'
import { importStarter, isStarterData } from './library'
import { newProgramme } from './programme'

let db: GymDb
let dbNumber = 0
const freshDb = () => new GymDb(`backup-test-${dbNumber++}`)

beforeEach(() => {
  db = freshDb()
})

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  programmeId: 'p1',
  weekNumber: 1,
  order: 0,
  name: 'Strength A',
  type: 'strength',
  blocks: [],
  isDeload: false,
  status: 'done',
  finishedAt: 1000,
  ...overrides,
})

const set = (id: string, sessionId = 's1'): SetLog => ({
  id,
  sessionId,
  blockId: 'b1',
  itemId: 'i1',
  exerciseId: 'cable-curl',
  round: 1,
  loggedAt: 1000,
  weightKg: 18,
  reps: 10,
})

async function fill(target: GymDb, suffix = '') {
  await target.exercises.add({ ...newExercise(`Cable Curl${suffix}`), notes: 'Slow on the way down' })
  await target.programmes.add(newProgramme({ id: `p1${suffix}`, name: `Arms${suffix}`, status: 'active' }))
  await target.sessions.add(session(`s1${suffix}`))
  await target.sets.add(set(`set1${suffix}`, `s1${suffix}`))
}

const asFile = (backup: unknown) => JSON.stringify(backup)
const validBackup = async () => {
  await fill(db)
  return createBackup(db, 5000)
}
const errorFrom = (text: string) => {
  try {
    parseBackup(text)
  } catch (error) {
    return error
  }
  return null
}

describe('making a backup', () => {
  it('covers every table that holds training data', async () => {
    const backup = await createBackup(db)
    const covered = new Set(Object.keys(backup))
    // If a later step adds a table, this fails until the backup includes it.
    const missing = db.tables.map((t) => t.name).filter((name) => name !== 'meta' && !covered.has(name))
    expect(missing).toEqual([])
  })

  it('records when it was made and which format it uses', async () => {
    const backup = await validBackup()
    expect(backup).toMatchObject({ app: 'gym-tracker', version: BACKUP_VERSION, exportedAt: 5000 })
    expect(isBackup(backup)).toBe(true)
  })

  it('names the file after the local date', () => {
    const at = new Date(2026, 10, 5, 23, 30).getTime()
    expect(backupFileName(at)).toBe('gym-tracker-backup-2026-11-05.json')
    expect(backupFileName(at, 'txt')).toBe('gym-tracker-backup-2026-11-05.txt')
    expect(backupFileName(at, 'json', 'gym-tracker-before-restore')).toBe('gym-tracker-before-restore-2026-11-05.json')
  })
})

describe('restoring a backup', () => {
  it('brings back everything exactly, through a real file round trip', async () => {
    const backup = await validBackup()
    const newPhone = freshDb()
    await restoreBackup(newPhone, parseBackup(asFile(backup)))
    expect(await newPhone.exercises.toArray()).toEqual(await db.exercises.toArray())
    expect(await newPhone.programmes.toArray()).toEqual(await db.programmes.toArray())
    expect(await newPhone.sessions.toArray()).toEqual(await db.sessions.toArray())
    expect(await newPhone.sets.toArray()).toEqual(await db.sets.toArray())
  })

  it('replaces what was there rather than mixing the two', async () => {
    const backup = await validBackup()
    const phone = freshDb()
    await fill(phone, ' old')
    await restoreBackup(phone, backup)
    expect((await phone.exercises.toArray()).map((e) => e.name)).toEqual(['Cable Curl'])
    expect((await phone.sets.toArray()).map((s) => s.id)).toEqual(['set1'])
  })

  it('changes nothing if the restore fails partway', async () => {
    const backup = await validBackup()
    const phone = freshDb()
    await fill(phone, ' old')
    // The second set clashes with the first, which fails only at the very last step.
    const broken: Backup = { ...backup, sets: [set('same'), set('same')] }
    await expect(restoreBackup(phone, broken)).rejects.toThrow()
    expect((await phone.exercises.toArray()).map((e) => e.name)).toEqual(['Cable Curl old'])
    expect((await phone.sessions.toArray()).map((s) => s.id)).toEqual(['s1 old'])
    expect((await phone.sets.toArray()).map((s) => s.id)).toEqual(['set1 old'])
    expect(await lastBackupAt(phone)).toBeUndefined()
  })

  it('keeps a workout in progress but clears its old rest timer', async () => {
    await db.sessions.add(session('in-progress', { status: 'active', restEndsAt: 999, finishedAt: undefined }))
    const backup = await createBackup(db)
    const phone = freshDb()
    await restoreBackup(phone, backup)
    const restored = await phone.sessions.get('in-progress')
    expect(restored?.status).toBe('active')
    expect(restored?.restEndsAt).toBeUndefined()
  })

  it('counts the restored data as backed up on the date of the file', async () => {
    const backup = await validBackup()
    const phone = freshDb()
    await restoreBackup(phone, backup)
    expect(await lastBackupAt(phone)).toBe(5000)
    expect(await workoutsSinceBackup(phone)).toBe(0)
  })
})

describe('choosing the wrong file', () => {
  const messageFor = (text: string) => (errorFrom(text) as Error).message

  it('explains a file that is not a backup', () => {
    for (const text of ['', 'not json', 'null', '42', '[]', '{}', '{"name":"holiday photos"}']) {
      const error = errorFrom(text)
      expect(error, text).toBeInstanceOf(BackupError)
      expect((error as Error).message).toBe(NOT_A_BACKUP)
    }
  })

  it('points a plans file to the right button', () => {
    expect(messageFor(asFile({ version: 1, revision: 'abc', programmes: [] }))).toContain('Load plans file')
  })

  it('asks for an app update when the backup is from a newer version', async () => {
    const backup = await validBackup()
    expect(messageFor(asFile({ ...backup, version: BACKUP_VERSION + 1 }))).toContain('newer version')
  })

  it('refuses damaged backups rather than wiping data', async () => {
    const backup = await validBackup()
    const damaged = [
      { ...backup, sets: undefined },
      { ...backup, sessions: 'nope' },
      { ...backup, exercises: [] },
      { ...backup, exportedAt: undefined },
      { ...backup, sets: [{ id: 'no session' }] },
      { ...backup, programmes: [{ id: 'p', name: 'P', status: 'active' }] },
    ]
    for (const file of damaged) expect(messageFor(asFile(file)), JSON.stringify(Object.keys(file))).toContain('damaged')
  })

  it('accepts a set that points at a deleted session', async () => {
    const backup = await validBackup()
    expect(() => parseBackup(asFile({ ...backup, sessions: [] }))).not.toThrow()
  })
})

describe('keeping plans files and backups apart', () => {
  it('never treats a backup as a plans file', async () => {
    const backup = await validBackup()
    expect(isStarterData(JSON.parse(asFile(backup)))).toBe(false)
  })

  it('still accepts a real plans file, which is not a backup', async () => {
    const plans = { version: 1, programmes: [{ key: 'a', name: 'A', lengthWeeks: 1, sessionsPerWeek: 1, deloadEnabled: false, rotation: [] }] }
    expect(isStarterData(plans)).toBe(true)
    expect(isBackup(plans)).toBe(false)
    expect(await importStarter(db, plans as Parameters<typeof importStarter>[1])).toBe(1)
  })
})

describe('tracking what needs backing up', () => {
  it('counts every finished workout until the first backup', async () => {
    await db.sessions.bulkAdd([session('a'), session('b'), session('planned', { status: 'planned', finishedAt: undefined })])
    expect(await lastBackupAt(db)).toBeUndefined()
    expect(await workoutsSinceBackup(db)).toBe(2)
  })

  it('counts only workouts finished after the last backup', async () => {
    await db.sessions.bulkAdd([session('old', { finishedAt: 100 }), session('new', { finishedAt: 300 })])
    await markBackedUp(db, 200)
    expect(await lastBackupAt(db)).toBe(200)
    expect(await workoutsSinceBackup(db)).toBe(1)
  })

  it('describes what is on the device and what is in a file the same way', async () => {
    const backup = await validBackup()
    const counts = await localCounts(db)
    expect(counts).toEqual(countBackup(backup))
    expect(describeCounts(counts)).toBe('1 workout, 1 set and 1 plan')
    expect(describeCounts({ workouts: 12, sets: 140, plans: 15 })).toBe('12 workouts, 140 sets and 15 plans')
    expect(hasNoData(counts)).toBe(false)
    expect(hasNoData({ workouts: 0, sets: 0, plans: 0 })).toBe(true)
  })
})

describe('updating a phone that already has data', () => {
  it('keeps all existing training data when the app updates', async () => {
    const name = 'backup-upgrade-test'
    const before = new Dexie(name)
    before.version(3).stores({
      exercises: 'id, name, kind',
      programmes: 'id, status, name',
      sessions: 'id, programmeId, [programmeId+weekNumber+order], status',
      sets: 'id, sessionId, exerciseId',
    })
    await before.open()
    await before.table('sessions').add(session('kept'))
    await before.table('sets').add(set('kept-set', 'kept'))
    before.close()

    const after = new GymDb(name)
    expect((await after.sessions.get('kept'))?.name).toBe('Strength A')
    expect((await after.sets.get('kept-set'))?.weightKg).toBe(18)
    await markBackedUp(after, 123)
    expect(await lastBackupAt(after)).toBe(123)
    after.close()
  })
})
