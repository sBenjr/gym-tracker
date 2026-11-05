import type { GymDb } from '../db'
import type { Block, BlockKind, Measure, Programme, SessionPlan, SessionType } from '../types'
import { exerciseId, fromSeed, newExercise, type SeedExercise } from './exercises'
import { newId } from './programme'

/** Adds any library exercises not there yet, leaving anything already edited alone. */
export async function ensureLibrary(db: GymDb, seed: SeedExercise[]): Promise<number> {
  const existing = new Set((await db.exercises.toCollection().primaryKeys()) as string[])
  const missing = seed.map(fromSeed).filter((e) => !existing.has(e.id))
  if (missing.length) await db.exercises.bulkAdd(missing)
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
  return data?.version === 1 && Array.isArray(data.programmes)
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
