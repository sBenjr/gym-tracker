import type { GymDb } from '../db'
import type { Block, BlockKind, Measure, Programme, SessionPlan, SessionType } from '../types'
import { exerciseId, fromSeed, newExercise, normalise, type SeedExercise } from './exercises'
import { newId } from './programme'

/**
 * Adds any library exercises not there yet, leaving anything already edited alone, and gives
 * existing ones any new search words. An exercise you added yourself that is still a plain
 * kg-and-reps move, and whose name the library knows as a cardio machine or carry (such as
 * "Indoor Row"), takes on that exercise's settings so it's logged by distance and time.
 */
export async function ensureLibrary(db: GymDb, seed: SeedExercise[]): Promise<number> {
  const library = seed.map(fromSeed)
  const libraryIds = new Set(library.map((e) => e.id))
  const existing = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  const missing = library.filter((e) => !existing.has(e.id))
  const cardio = library.filter((e) => e.kind === 'conditioning' && e.measure !== 'reps')
  await db.transaction('rw', db.exercises, async () => {
    if (missing.length) await db.exercises.bulkAdd(missing)
    for (const exercise of library) {
      const mine = existing.get(exercise.id)
      const extra = mine ? exercise.aliases.filter((alias) => !mine.aliases.includes(alias)) : []
      if (mine && extra.length) await db.exercises.update(mine.id, { aliases: [...mine.aliases, ...extra] })
    }
    for (const mine of existing.values()) {
      if (libraryIds.has(mine.id) || mine.kind !== 'strength' || mine.measure !== 'reps') continue
      const name = normalise(mine.name)
      const match = cardio.find((e) => e.aliases.some((alias) => normalise(alias) === name))
      if (match) {
        const { kind, equipment, load, measure, restSec, incrementKg } = match
        await db.exercises.update(mine.id, { kind, equipment, load, measure, restSec, incrementKg })
      }
    }
  })
  return missing.length
}

export interface StarterItem {
  exercise: string
  measure?: Measure
  min?: number
  max?: number
  perSide?: boolean
  rir?: number
  weightKg?: number
  goalKg?: number
  note?: string
  restAfterSec?: number
}

export interface StarterBlock {
  kind?: BlockKind
  rounds: number
  restSec?: number
  items: StarterItem[]
}

export interface StarterSession {
  name: string
  type: SessionType
  notes?: string
  blocks: StarterBlock[]
}

export interface StarterProgramme {
  key: string
  name: string
  lengthWeeks: number
  sessionsPerWeek: number
  deloadEnabled: boolean
  notes?: string
  rotation: StarterSession[]
}

export interface StarterData {
  version: 1
  /** Changes whenever the plans change, so this computer knows to reload them. */
  revision?: string
  programmes: StarterProgramme[]
}

export function isStarterData(value: unknown): value is StarterData {
  const data = value as StarterData
  // A backup also has a version and programmes, but its programmes have no key.
  return data?.version === 1 && Array.isArray(data.programmes) && data.programmes.every((p) => typeof p?.key === 'string')
}

/** Loads past plans as ones to copy from. Running it twice replaces them rather than doubling up. */
export async function importStarter(db: GymDb, data: StarterData): Promise<number> {
  const known = await db.exercises.toArray()
  const ids = new Set(known.map((e) => e.id))
  const created = new Map<string, ReturnType<typeof newExercise>>()

  const toBlock = (block: StarterBlock): Block => ({
    id: newId(),
    kind: block.kind ?? (block.items.length > 1 ? 'superset' : 'straight'),
    rounds: block.rounds,
    ...(block.restSec !== undefined ? { restSec: block.restSec } : {}),
    items: block.items.map((item) => {
      const id = exerciseId(item.exercise)
      if (!ids.has(id) && !created.has(id)) {
        created.set(id, newExercise(item.exercise, { check: 'Added by an import; check the details.' }))
      }
      return {
        id: newId(),
        exerciseId: id,
        ...(item.restAfterSec !== undefined ? { restAfterSec: item.restAfterSec } : {}),
        target: {
          measure: item.measure ?? 'reps',
          min: item.min ?? item.max ?? 10,
          max: item.max ?? item.min ?? 10,
          ...(item.perSide ? { perSide: true } : {}),
          ...(item.rir !== undefined ? { rir: item.rir } : {}),
          ...(item.weightKg !== undefined ? { weightKg: item.weightKg } : {}),
          ...(item.goalKg !== undefined ? { goalKg: item.goalKg } : {}),
          ...(item.note ? { note: item.note } : {}),
        },
      }
    }),
  })

  const importedAt = Date.now()
  const programmes = data.programmes.map(
    (p, index): Programme => ({
      id: `template-${p.key}`,
      name: p.name,
      status: 'template',
      lengthWeeks: p.lengthWeeks,
      sessionsPerWeek: p.sessionsPerWeek,
      deloadEnabled: p.deloadEnabled,
      // Lists show newest first, so this keeps the file's order.
      createdAt: importedAt - index,
      ...(p.notes ? { notes: p.notes } : {}),
      rotation: p.rotation.map(
        (s): SessionPlan => ({
          id: newId(),
          name: s.name,
          type: s.type,
          blocks: s.blocks.map(toBlock),
          ...(s.notes ? { notes: s.notes } : {}),
        }),
      ),
    }),
  )

  await db.transaction('rw', db.exercises, db.programmes, async () => {
    if (created.size) await db.exercises.bulkAdd([...created.values()])
    await db.programmes.bulkPut(programmes)
  })
  return programmes.length
}
