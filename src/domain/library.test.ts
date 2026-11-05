import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { GymDb } from '../db'
import seed from '../../seed/exercises.json'
import { exerciseId, matchesSearch, searchExercises, type SeedExercise } from './exercises'
import { ensureLibrary, importStarter, isStarterData, type StarterData } from './library'

const library = seed as SeedExercise[]
let db: GymDb
let dbNumber = 0

beforeEach(() => {
  db = new GymDb(`test-${dbNumber++}`)
})

const starter: StarterData = {
  version: 1,
  programmes: [
    {
      key: 'hyrox',
      name: 'Hyrox',
      lengthWeeks: 13,
      sessionsPerWeek: 6,
      deloadEnabled: false,
      rotation: [
        {
          name: 'Hyrox A',
          type: 'hyrox',
          blocks: [
            {
              rounds: 3,
              restSec: 90,
              items: [
                { exercise: 'Smith Front Squat', max: 8, rir: 2, weightKg: 20, goalKg: 40 },
                { exercise: 'A Brand New Move', measure: 'seconds', min: 20, max: 40 },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('the seed library', () => {
  it('has unique ids and valid defaults', () => {
    const ids = library.map((e) => exerciseId(e.name))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('loads once and leaves your edits alone when it loads again', async () => {
    expect(await ensureLibrary(db, library)).toBe(library.length)
    const id = exerciseId('Leg Extension')
    await db.exercises.update(id, { restSec: 75 })
    expect(await ensureLibrary(db, library)).toBe(0)
    expect((await db.exercises.get(id))?.restSec).toBe(75)
  })

  it('moves an existing library from the old 2 minute rest to 45 seconds, keeping custom rests', async () => {
    const name = `upgrade-${dbNumber++}`
    const old = new Dexie(name)
    old.version(1).stores({ exercises: 'id, name, kind', programmes: 'id, status, name', sessions: 'id' })
    await old.open()
    await old.table('exercises').bulkAdd([
      { id: 'a', name: 'A', kind: 'strength', restSec: 120 },
      { id: 'b', name: 'B', kind: 'strength', restSec: 75 },
      { id: 'c', name: 'C', kind: 'conditioning', restSec: 120 },
    ])
    old.close()
    const upgraded = new GymDb(name)
    expect((await upgraded.exercises.get('a'))?.restSec).toBe(45)
    expect((await upgraded.exercises.get('b'))?.restSec).toBe(75)
    expect((await upgraded.exercises.get('c'))?.restSec).toBe(120)
  })

  it('treats assisted moves as assisted and records known machine weights', async () => {
    await ensureLibrary(db, library)
    expect((await db.exercises.get(exerciseId('Assisted Pull-Up')))?.load).toBe('assisted')
    expect((await db.exercises.get(exerciseId('Leg Press 45°')))?.baseWeightKg).toBe(47.5)
  })
})

describe('search', () => {
  it('finds exercises by old names and diary shorthand', async () => {
    await ensureLibrary(db, library)
    const all = await db.exercises.toArray()
    const names = (q: string) => searchExercises(all, q).map((e) => e.name)
    expect(names('chest press on a bench')).toContain('Smith Bench Press')
    expect(names('lever leg extension')).toContain('Leg Extension')
    expect(names('db bench')).toContain('Dumbbell Bench Press')
    expect(names('sm squat')).toContain('Smith Full Squat')
    expect(names('pulldown')).toContain('Lat Pulldown')
  })

  it('matches everything on an empty search, and can filter to entries needing a check', async () => {
    await ensureLibrary(db, library)
    const all = await db.exercises.toArray()
    expect(matchesSearch(all[0], '  ')).toBe(true)
    expect(searchExercises(all, '', 'check').every((e) => !!e.check)).toBe(true)
    expect(searchExercises(all, '', 'mobility').every((e) => e.kind === 'mobility')).toBe(true)
  })
})

describe('importStarter', () => {
  it('rejects anything that is not a starter file', () => {
    expect(isStarterData({ hello: 1 })).toBe(false)
    expect(isStarterData(starter)).toBe(true)
  })

  it('loads past plans, adds unknown exercises for checking, and does not double up', async () => {
    await ensureLibrary(db, library)
    expect(await importStarter(db, starter)).toBe(1)
    expect(await importStarter(db, starter)).toBe(1)
    const saved = await db.programmes.toArray()
    expect(saved).toHaveLength(1)
    expect(saved[0].status).toBe('template')
    const block = saved[0].rotation[0].blocks[0]
    expect(block.kind).toBe('superset')
    expect(block.items[0].target).toMatchObject({ measure: 'reps', min: 8, max: 8, rir: 2, weightKg: 20, goalKg: 40 })
    expect(block.items[1].target).toMatchObject({ measure: 'seconds', min: 20, max: 40 })
    expect((await db.exercises.get(exerciseId('A Brand New Move')))?.check).toBeTruthy()
  })
})
