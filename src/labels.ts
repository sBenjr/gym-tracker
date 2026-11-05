import type { BlockKind, Category, Equipment, ExerciseKind, LoadType, Measure, SessionType } from './types'

type Options<T> = { value: T; label: string }[]

export const SESSION_TYPES: Options<SessionType> = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'hiit', label: 'HIIT' },
  { value: 'hyrox', label: 'Hyrox' },
  { value: 'mobility', label: 'Mobility' },
]

export const MEASURES: Options<Measure> = [
  { value: 'reps', label: 'Reps' },
  { value: 'seconds', label: 'Time' },
  { value: 'metres', label: 'Distance' },
]

export const BLOCK_KINDS: Options<BlockKind> = [
  { value: 'superset', label: 'Superset' },
  { value: 'circuit', label: 'Circuit' },
]

export const EXERCISE_KINDS: Options<ExerciseKind> = [
  { value: 'strength', label: 'Strength' },
  { value: 'conditioning', label: 'Conditioning' },
  { value: 'mobility', label: 'Mobility' },
]

export const CATEGORIES: Options<Category> = [
  { value: 'lower_compound', label: 'Lower compound' },
  { value: 'upper_compound', label: 'Upper compound' },
  { value: 'isolation', label: 'Isolation' },
  { value: 'core', label: 'Core' },
]

export const EQUIPMENT: Options<Equipment> = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'smith', label: 'Smith' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'cable', label: 'Cable' },
  { value: 'machine', label: 'Machine' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'sled', label: 'Sled' },
  { value: 'cardio_machine', label: 'Cardio machine' },
  { value: 'other', label: 'Other' },
]

export const LOAD_TYPES: Options<LoadType> = [
  { value: 'weighted', label: 'Weighted' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'assisted', label: 'Assisted' },
]

export const labelFor = <T,>(options: Options<T>, value: T) =>
  options.find((option) => option.value === value)?.label ?? ''
