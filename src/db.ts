import Dexie, { type Table } from 'dexie'
import type { Exercise, Programme, Session, SetLog } from './types'

export class GymDb extends Dexie {
  exercises!: Table<Exercise, string>
  programmes!: Table<Programme, string>
  sessions!: Table<Session, string>
  sets!: Table<SetLog, string>

  constructor(name = 'gym-tracker') {
    super(name)
    this.version(1).stores({
      exercises: 'id, name, kind',
      programmes: 'id, status, name',
      sessions: 'id, programmeId, [programmeId+weekNumber+order], status',
    })
    // Strength rest moved from the original 2 minute default to 45 seconds.
    this.version(2).upgrade((tx) =>
      tx
        .table<Exercise, string>('exercises')
        .toCollection()
        .modify((exercise) => {
          if (exercise.kind === 'strength' && exercise.restSec === 120) exercise.restSec = 45
        }),
    )
    this.version(3).stores({ sets: 'id, sessionId, exerciseId' })
  }
}

export const db = new GymDb()
