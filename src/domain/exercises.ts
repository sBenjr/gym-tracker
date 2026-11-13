import type { Equipment, Exercise, ExerciseKind, Measure } from '../types'

export interface SeedExercise {
  name: string
  kind?: string
  category?: string
  equipment: string
  load: string
  measure?: string
  incrementKg?: number
  baseWeightKg?: number
  aliases: string[]
  check?: string
}

// Most of the steps in the 2023-24 diary: dumbbells rise by 2kg and pin-loaded stacks by 4.5kg.
const INCREMENT_BY_EQUIPMENT: Record<Equipment, number> = {
  barbell: 2.5,
  smith: 2.5,
  dumbbell: 2,
  kettlebell: 4,
  cable: 4.5,
  machine: 4.5,
  sled: 10,
  bodyweight: 0,
  cardio_machine: 0,
  other: 2.5,
}

const REST_BY_KIND: Record<ExerciseKind, number> = { strength: 45, conditioning: 90, mobility: 30 }

export const exerciseId = (name: string) =>
  'ex-' + name.toLowerCase().replace(/°/g, 'deg').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const defaultIncrement = (equipment: Equipment) => INCREMENT_BY_EQUIPMENT[equipment]

export function newExercise(name: string, overrides: Partial<Exercise> = {}): Exercise {
  const kind = overrides.kind ?? 'strength'
  const equipment = overrides.equipment ?? 'other'
  return {
    id: exerciseId(name),
    name,
    kind,
    equipment,
    load: 'weighted',
    measure: 'reps',
    incrementKg: defaultIncrement(equipment),
    restSec: REST_BY_KIND[kind],
    aliases: [],
    archived: false,
    ...overrides,
  }
}

export function fromSeed(seed: SeedExercise): Exercise {
  const equipment = (seed.equipment === 'unknown' ? 'other' : seed.equipment) as Equipment
  return newExercise(seed.name, {
    kind: (seed.kind ?? 'strength') as ExerciseKind,
    category: seed.category as Exercise['category'],
    equipment,
    load: seed.load as Exercise['load'],
    measure: (seed.measure ?? 'reps') as Measure,
    ...(seed.incrementKg !== undefined ? { incrementKg: seed.incrementKg } : {}),
    ...(seed.baseWeightKg !== undefined ? { baseWeightKg: seed.baseWeightKg } : {}),
    aliases: seed.aliases,
    ...(seed.check ? { check: seed.check } : {}),
  })
}

// The shorthand used in the training diary, so typing it finds the right exercise.
const SHORTHAND: Record<string, string> = {
  db: 'dumbbell',
  bb: 'barbell',
  sm: 'smith',
  kb: 'kettlebell',
  ez: 'ez',
  rdl: 'romanian deadlift',
  ext: 'extension',
  tricep: 'triceps',
  bicep: 'biceps',
  pulldown: 'pull down',
}

export const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9/° ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SHORTHAND[word] ?? word)
    .join(' ')
    .replace(/pulldown/g, 'pull down')

export function matchesSearch(exercise: Exercise, query: string): boolean {
  const words = normalise(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const haystack = [exercise.name, ...exercise.aliases].map(normalise).join(' | ')
  return words.every((word) => haystack.includes(word))
}

export function searchExercises(
  exercises: Exercise[],
  query: string,
  kind?: ExerciseKind | 'check',
): Exercise[] {
  return exercises
    .filter((e) => !e.archived)
    .filter((e) => (kind === 'check' ? !!e.check : kind ? e.kind === kind : true))
    .filter((e) => matchesSearch(e, query))
    .sort((a, b) => a.name.localeCompare(b.name))
}
