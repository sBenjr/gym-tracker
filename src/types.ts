export type ExerciseKind = 'strength' | 'conditioning' | 'mobility'
export type Category = 'lower_compound' | 'upper_compound' | 'isolation' | 'core'
export type Equipment =
  | 'barbell'
  | 'smith'
  | 'dumbbell'
  | 'kettlebell'
  | 'cable'
  | 'machine'
  | 'bodyweight'
  | 'sled'
  | 'cardio_machine'
  | 'other'
export type LoadType = 'weighted' | 'bodyweight' | 'assisted'
export type Measure = 'reps' | 'seconds' | 'metres'
export type SessionType = 'strength' | 'cardio' | 'hiit' | 'hyrox' | 'mobility'
export type BlockKind = 'straight' | 'superset' | 'circuit'
export type ProgrammeStatus = 'template' | 'draft' | 'active' | 'archived'
export type SessionStatus = 'planned' | 'active' | 'done' | 'skipped'

export interface Exercise {
  id: string
  name: string
  kind: ExerciseKind
  category?: Category
  equipment: Equipment
  load: LoadType
  measure: Measure
  /** The smallest weight jump available on this exercise. */
  incrementKg: number
  restSec: number
  /** Weight of the bar or machine carriage, on top of the number you log. */
  baseWeightKg?: number
  /** Your own cues, shown whenever you do this exercise. */
  notes?: string
  /** Other names for the same exercise, so search finds it. */
  aliases: string[]
  archived: boolean
  /** Why this entry needs a human to check it. */
  check?: string
}

export interface Target {
  measure: Measure
  min: number
  max: number
  perSide?: boolean
  rir?: number
  /** Where to start. Sessions often begin lighter and build up. */
  weightKg?: number
  /** The weight being built towards, such as a race weight. */
  goalKg?: number
  note?: string
}

export interface BlockItem {
  id: string
  exerciseId: string
  target: Target
  restAfterSec?: number
}

/**
 * One exercise done for several sets is a block with one item; a superset or
 * circuit is a block with several items repeated for the same number of rounds.
 */
export interface Block {
  id: string
  kind: BlockKind
  rounds: number
  restSec?: number
  items: BlockItem[]
}

export interface SessionPlan {
  id: string
  name: string
  type: SessionType
  blocks: Block[]
  notes?: string
}

export interface Programme {
  id: string
  name: string
  status: ProgrammeStatus
  lengthWeeks: number
  sessionsPerWeek: number
  startDate?: string
  deloadEnabled: boolean
  /** The repeating list of sessions, laid out across the weeks in order. */
  rotation: SessionPlan[]
  notes?: string
  createdAt: number
}

export interface Session {
  id: string
  programmeId: string | null
  /** The rotation entry this session was generated from. */
  slotId?: string
  weekNumber: number
  order: number
  name: string
  type: SessionType
  blocks: Block[]
  isDeload: boolean
  status: SessionStatus
  plannedDate?: string
  startedAt?: number
  finishedAt?: number
  completedDate?: string
  notes?: string
  /** An end time rather than a countdown, so rest stays right if the phone locks or the app reloads. */
  restEndsAt?: number
  skippedItemIds?: string[]
}

/** Only confirmed sets are saved, so pre-filled values can never reach your history. */
export interface SetLog {
  id: string
  sessionId: string
  blockId: string
  itemId: string
  exerciseId: string
  /** Which set or round of the block this was, counting from 1. */
  round: number
  loggedAt: number
  weightKg?: number
  reps?: number
  seconds?: number
  metres?: number
  rir?: number
  effort?: number
  avgHr?: number
  /** HIIT is logged as one entry for the whole block. */
  rounds?: number
  workSec?: number
  restSec?: number
  notes?: string
}
