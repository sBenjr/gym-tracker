import type { Block, BlockItem, Exercise, Programme, Session, SessionPlan, SessionType, Target } from '../types'

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const MIN_WEEKS = 1
export const MAX_WEEKS = 16
export const STRENGTH_REST_SEC = 45
export const HYROX_REST_SEC = 90

export const sessionRestSec = (type: SessionType) => (type === 'hyrox' ? HYROX_REST_SEC : STRENGTH_REST_SEC)

/** A rest set in the plan wins; otherwise Hyrox sessions use 90 seconds and the rest use the exercise's own. */
export function restSecFor(type: SessionType, block: Block, exercise?: Exercise): number {
  if (block.restSec !== undefined) return block.restSec
  if (type === 'hyrox' && exercise?.kind !== 'mobility') return HYROX_REST_SEC
  return exercise?.restSec ?? STRENGTH_REST_SEC
}

// Days after the start of each programme week, so a Monday start gives Mon/Wed/Fri at 3 a week.
const DAY_OFFSETS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function nextMonday(from: Date = new Date()): string {
  const iso = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))
  const daysAhead = (8 - iso.getUTCDay()) % 7
  iso.setUTCDate(iso.getUTCDate() + daysAhead)
  return iso.toISOString().slice(0, 10)
}

export function newProgramme(overrides: Partial<Programme> = {}): Programme {
  return {
    id: newId(),
    name: 'New programme',
    status: 'draft',
    lengthWeeks: 8,
    sessionsPerWeek: 3,
    startDate: nextMonday(),
    deloadEnabled: true,
    rotation: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

export const newSessionPlan = (name: string, type: SessionType = 'strength'): SessionPlan => ({
  id: newId(),
  name,
  type,
  blocks: [],
})

/** The usual week: two strength sessions and one Hyrox-style session, over 8 weeks. */
export const standardDraft = (): Programme =>
  newProgramme({
    rotation: [newSessionPlan('Strength 1'), newSessionPlan('Strength 2'), newSessionPlan('Hyrox', 'hyrox')],
  })

/** A sensible starting target: the diary's most common pattern is 3 sets of 10. */
export function defaultTarget(exercise: Exercise): Target {
  if (exercise.measure === 'seconds') return { measure: 'seconds', min: 60, max: 60 }
  if (exercise.measure === 'metres') return { measure: 'metres', min: 400, max: 400 }
  return { measure: 'reps', min: 10, max: 10 }
}

export function newBlock(exercise: Exercise): Block {
  const singleEffort = exercise.kind === 'conditioning' && exercise.measure !== 'reps'
  return {
    id: newId(),
    kind: 'straight',
    rounds: singleEffort ? 1 : exercise.kind === 'mobility' ? 1 : 3,
    items: [{ id: newId(), exerciseId: exercise.id, target: defaultTarget(exercise) }],
  }
}

export function linkWithNext(blocks: Block[], index: number, defaultRestSec = STRENGTH_REST_SEC): Block[] {
  const first = blocks[index]
  const second = blocks[index + 1]
  if (!first || !second) return blocks
  const merged: Block = {
    id: first.id,
    kind: first.kind === 'circuit' || second.kind === 'circuit' ? 'circuit' : 'superset',
    rounds: Math.max(first.rounds, second.rounds),
    restSec: first.restSec ?? second.restSec ?? defaultRestSec,
    items: [...first.items, ...second.items],
  }
  return [...blocks.slice(0, index), merged, ...blocks.slice(index + 2)]
}

export function unlink(blocks: Block[], index: number): Block[] {
  const block = blocks[index]
  if (!block) return blocks
  const separate = block.items.map(
    (item, i): Block => ({ id: i === 0 ? block.id : newId(), kind: 'straight', rounds: block.rounds, items: [item] }),
  )
  return [...blocks.slice(0, index), ...separate, ...blocks.slice(index + 1)]
}

export function move<T>(list: T[], index: number, by: number): T[] {
  const to = index + by
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  return next
}

function reduceToSeventyPercent(target: Target): Target {
  const scale = (value: number) => Math.max(5, Math.round((value * 0.7) / 5) * 5)
  return { ...target, min: scale(target.min), max: scale(target.max) }
}

/** Deload volume: about half the rounds, or 70% of a single timed or distance effort. */
export function applyDeload(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    if (block.rounds > 1) return { ...block, rounds: Math.ceil(block.rounds / 2) }
    return {
      ...block,
      items: block.items.map(
        (item): BlockItem =>
          item.target.measure === 'reps' || item.target.max === 0
            ? item
            : { ...item, target: reduceToSeventyPercent(item.target) },
      ),
    }
  })
}

const clonePlanBlocks = (blocks: Block[]): Block[] => structuredClone(blocks)

export const isDeloadWeek = (programme: Programme, weekNumber: number) =>
  programme.deloadEnabled && programme.lengthWeeks > 1 && weekNumber === programme.lengthWeeks

/** Lays the rotation out in order, so it keeps going across the weeks whatever its length. */
export function generateSessions(programme: Programme): Session[] {
  const { rotation, lengthWeeks, sessionsPerWeek, startDate } = programme
  if (rotation.length === 0) return []
  const offsets = DAY_OFFSETS[sessionsPerWeek] ?? DAY_OFFSETS[3]
  const sessions: Session[] = []
  for (let i = 0; i < lengthWeeks * sessionsPerWeek; i++) {
    const slot = rotation[i % rotation.length]
    const weekNumber = Math.floor(i / sessionsPerWeek) + 1
    const order = i % sessionsPerWeek
    const isDeload = isDeloadWeek(programme, weekNumber)
    const blocks = clonePlanBlocks(slot.blocks)
    sessions.push({
      id: newId(),
      programmeId: programme.id,
      slotId: slot.id,
      weekNumber,
      order,
      name: slot.name,
      type: slot.type,
      blocks: isDeload ? applyDeload(blocks) : blocks,
      isDeload,
      status: 'planned',
      ...(startDate ? { plannedDate: addDays(startDate, (weekNumber - 1) * 7 + offsets[order]) } : {}),
    })
  }
  return sessions
}

/** Rebuilds the plan after a change, keeping any session already started or finished. */
export function regenerateSessions(programme: Programme, existing: Session[]): Session[] {
  const kept = new Map(
    existing.filter((s) => s.status !== 'planned').map((s) => [`${s.weekNumber}-${s.order}`, s]),
  )
  return generateSessions(programme).map((s) => kept.get(`${s.weekNumber}-${s.order}`) ?? s)
}

/** Applies an edited session to the rotation and to every later session not yet started. */
export function applyToRemaining(session: Session, sessions: Session[]): Session[] {
  const later = (s: Session) =>
    s.weekNumber > session.weekNumber || (s.weekNumber === session.weekNumber && s.order > session.order)
  return sessions
    .filter((s) => s.id !== session.id && s.slotId === session.slotId && s.status === 'planned' && later(s))
    .map((s) => {
      const blocks = clonePlanBlocks(session.blocks)
      return { ...s, name: session.name, type: session.type, blocks: s.isDeload ? applyDeload(blocks) : blocks }
    })
}

/** A new draft from any programme or past plan: its sessions and targets, but no logged history. */
export function copyProgramme(source: Programme, name = `${source.name} (copy)`): Programme {
  return {
    ...structuredClone(source),
    id: newId(),
    name,
    status: 'draft',
    startDate: nextMonday(),
    createdAt: Date.now(),
    rotation: source.rotation.map((slot) => ({ ...structuredClone(slot), id: newId() })),
  }
}

/** The first weeks of the rotation, as a preview while building. */
export function previewWeeks(programme: Programme, weeks = 2): string[][] {
  const { rotation, sessionsPerWeek } = programme
  if (rotation.length === 0) return []
  return Array.from({ length: Math.min(weeks, programme.lengthWeeks) }, (_, week) =>
    Array.from(
      { length: sessionsPerWeek },
      (_, day) => rotation[(week * sessionsPerWeek + day) % rotation.length].name,
    ),
  )
}

export function totalSessions(programme: Programme): number {
  return programme.lengthWeeks * programme.sessionsPerWeek
}

export const countExercises = (plan: { blocks: Block[] }) =>
  plan.blocks.reduce((sum, block) => sum + block.items.length, 0)

function formatAmount(target: Target, withRounds: boolean): string {
  const { measure, min, max } = target
  if (measure === 'seconds' && max >= 120 && max % 60 === 0 && min % 60 === 0) {
    return min === max ? `${max / 60} min` : `${min / 60}-${max / 60} min`
  }
  const range = min === max ? `${max}` : `${min}-${max}`
  if (measure === 'seconds') return `${range}s`
  if (measure === 'metres') return `${range}m`
  return withRounds ? range : `${range} reps`
}

/** Reads like the plans in the old app: "3 x 8-10 @ RIR 2", "3 x 20m", "8 reps each side". */
export function formatTarget(target: Target, rounds?: number): string {
  if (target.max === 0) return 'Warm-up'
  const amount = formatAmount(target, !!rounds) + (target.perSide ? ' each side' : '')
  const base = rounds ? `${rounds} x ${amount}` : amount
  const load =
    (target.weightKg ? ` @ ${target.weightKg}kg` : '') +
    (target.goalKg ? `, building to ${target.goalKg}kg` : '')
  const effort = target.rir !== undefined ? ` @ RIR ${target.rir}` : ''
  return base + load + effort
}

export const formatDate = (isoDate?: string) =>
  isoDate
    ? new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : ''
