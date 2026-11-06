import type { GymDb } from '../db'
import type { Block, BlockItem, Exercise, Session, SetLog, Target } from '../types'
import { newId, restSecFor } from './programme'

export interface PlannedSet {
  block: Block
  item: BlockItem
  round: number
}

export const todayIso = (now: Date = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

export const isTickOnly = (target: Target, exercise?: Exercise) => target.max === 0 || exercise?.kind === 'mobility'

/** Every strength move can take a weight, such as a plate held for sit-ups; runs and rows can't. */
export function takesWeight(exercise?: Exercise): boolean {
  if (!exercise || exercise.kind === 'mobility') return false
  return exercise.kind === 'strength' || exercise.load !== 'bodyweight'
}

/** HIIT is logged once for the whole block; everything else once per set or round. */
const logsPerItem = (session: Session, block: Block) => (session.type === 'hiit' ? 1 : block.rounds)

/** Supersets and circuits alternate: A1, B1, A2, B2. */
export function plannedSets(session: Session): PlannedSet[] {
  return session.blocks.flatMap((block) =>
    Array.from({ length: logsPerItem(session, block) }, (_, i) => i + 1).flatMap((round) =>
      block.items.map((item) => ({ block, item, round })),
    ),
  )
}

export function remainingSets(session: Session, logs: SetLog[]): PlannedSet[] {
  const skipped = new Set(session.skippedItemIds ?? [])
  const logged = new Set(logs.map((log) => `${log.itemId}-${log.round}`))
  return plannedSets(session).filter((p) => !skipped.has(p.item.id) && !logged.has(`${p.item.id}-${p.round}`))
}

/** Stays within the current block where possible, then moves to the first exercise still to do. */
export function nextSet(session: Session, logs: SetLog[], preferBlockId?: string): PlannedSet | null {
  const remaining = remainingSets(session, logs)
  return remaining.find((p) => p.block.id === preferBlockId) ?? remaining[0] ?? null
}

/** The first set number not logged yet, which runs past the plan when you add an extra set. */
export function nextRound(itemId: string, logs: SetLog[]): number {
  const logged = new Set(logs.filter((log) => log.itemId === itemId).map((log) => log.round))
  let round = 1
  while (logged.has(round)) round++
  return round
}

export function findItem(session: Session, itemId: string): { block: Block; item: BlockItem } | null {
  for (const block of session.blocks) {
    const item = block.items.find((it) => it.id === itemId)
    if (item) return { block, item }
  }
  return null
}

const inOrder = (a: Session, b: Session) => a.weekNumber - b.weekNumber || a.order - b.order

/** Goes by order, not date, so a missed session stays next until you do or skip it. */
export function nextSession(sessions: Session[]): Session | null {
  const sorted = [...sessions].sort(inOrder)
  return sorted.find((s) => s.status === 'active') ?? sorted.find((s) => s.status === 'planned') ?? null
}

/** Exchanges two sessions' places in the week, keeping the planned days where they are. */
export function swapSessions(a: Session, b: Session): [Session, Session] {
  return [
    { ...a, order: b.order, plannedDate: b.plannedDate },
    { ...b, order: a.order, plannedDate: a.plannedDate },
  ]
}

/** No rest between exercises in a superset, only after the round. */
export function restAfter(session: Session, block: Block, item: BlockItem, exercise?: Exercise): number {
  if (item.restAfterSec) return item.restAfterSec
  if (isTickOnly(item.target, exercise)) return block.items.at(-1)?.id === item.id && block.restSec ? block.restSec : 0
  if (block.items.length > 1) return block.items.at(-1)?.id === item.id ? restSecFor(session.type, block, exercise) : 0
  if (block.rounds === 1 && block.restSec === undefined) return 0
  return restSecFor(session.type, block, exercise)
}

export interface LastPerformance {
  date?: string
  sets: SetLog[]
}

/** The latest finished, non-deload session with this exercise; deload weights must not set the baseline. */
export function lastPerformance(
  exerciseId: string,
  currentSessionId: string,
  sets: SetLog[],
  sessions: (Session | undefined)[],
): LastPerformance | null {
  const session = sessions
    .filter((s): s is Session => !!s && s.status === 'done' && !s.isDeload && s.id !== currentSessionId)
    .filter((s) => sets.some((set) => set.sessionId === s.id && set.exerciseId === exerciseId))
    .sort((a, b) => (b.completedDate ?? '').localeCompare(a.completedDate ?? '') || (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
  if (!session) return null
  return {
    date: session.completedDate,
    sets: sets.filter((set) => set.sessionId === session.id && set.exerciseId === exerciseId).sort((a, b) => a.round - b.round),
  }
}

export type SetDraft = Pick<
  SetLog,
  'weightKg' | 'reps' | 'seconds' | 'metres' | 'rir' | 'effort' | 'avgHr' | 'rounds' | 'workSec' | 'restSec' | 'notes'
>

const roundKg = (kg: number) => Math.round(kg * 100) / 100

/**
 * Starts from the same set last time, because lighter build-up sets mean each set has its own weight.
 * If today's weights have moved, later sets move by the same amount. RIR and effort are never
 * pre-filled, because confirming a pre-filled value would record a feeling you never had.
 */
export function prefill(
  session: Session,
  block: Block,
  target: Target,
  round: number,
  last: SetLog[],
  today: SetLog[],
): SetDraft {
  const sameSet = last.find((s) => s.round === round) ?? last.at(-1)
  const earlier = [...today].filter((s) => s.round < round).sort((a, b) => b.round - a.round)[0]

  let weightKg = sameSet?.weightKg ?? earlier?.weightKg ?? target.weightKg
  if (sameSet?.weightKg !== undefined && earlier?.weightKg !== undefined) {
    const lastEarlier = last.find((s) => s.round === earlier.round)
    if (lastEarlier?.weightKg !== undefined) weightKg = roundKg(sameSet.weightKg + earlier.weightKg - lastEarlier.weightKg)
  }

  if (session.type === 'hiit') {
    const workSec = sameSet?.workSec ?? target.max
    return {
      rounds: sameSet?.rounds ?? block.rounds,
      workSec,
      restSec: sameSet?.restSec ?? block.restSec ?? workSec * 3,
    }
  }
  // Reps, time and distance always come from the plan; only the weight moves on from last time.
  return {
    weightKg,
    reps: target.measure === 'reps' ? target.min : sameSet?.reps,
    seconds: target.measure === 'seconds' ? target.max : sameSet?.seconds,
    metres: target.measure === 'metres' ? target.max : sameSet?.metres,
  }
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Accepts "1:30" or a plain number of seconds. */
export function parseDuration(text: string): number | null {
  const match = text.trim().match(/^(?:(\d+):)?(\d+)$/)
  if (!match) return null
  return (match[1] ? parseInt(match[1], 10) * 60 : 0) + parseInt(match[2], 10)
}

export function formatSet(set: SetDraft): string {
  if (set.workSec !== undefined) {
    return `${set.rounds ?? 1} rounds, ${set.workSec}s work, ${set.restSec ?? 0}s rest`
  }
  const amount = [
    set.metres ? `${set.metres}m` : '',
    set.seconds ? (set.metres ? `in ${formatDuration(set.seconds)}` : formatDuration(set.seconds)) : '',
  ]
    .filter(Boolean)
    .join(' ')
  const weight = set.weightKg ? `${set.weightKg}kg` : ''
  if (set.reps !== undefined) return [weight, weight ? `x ${set.reps}` : `${set.reps} reps`, amount].filter(Boolean).join(' ')
  return [amount, weight ? `@ ${weight}` : ''].filter(Boolean).join(' ') || 'Done'
}

/** "60kg x 8, 8, 7" when the weight held, otherwise each set's own weight. */
export function formatLast(sets: SetDraft[]): string {
  if (sets.length === 0) return ''
  const weights = new Set(sets.map((s) => s.weightKg))
  if (sets.every((s) => s.reps !== undefined && !s.seconds && !s.metres) && weights.size === 1) {
    const [weight] = weights
    const reps = sets.map((s) => s.reps).join(', ')
    return weight ? `${weight}kg x ${reps}` : `${reps} reps`
  }
  return sets.map(formatSet).join(', ')
}

export async function startWorkout(db: GymDb, sessionId: string, now = Date.now()) {
  await db.sessions.update(sessionId, { status: 'active', startedAt: now })
}

/** Saves the set straight away, and starts the rest timer in the same step. */
export async function logSet(
  db: GymDb,
  session: Session,
  block: Block,
  item: BlockItem,
  round: number,
  draft: SetDraft,
  exercise?: Exercise,
  now = Date.now(),
): Promise<SetLog> {
  const set: SetLog = { ...draft, id: newId(), sessionId: session.id, blockId: block.id, itemId: item.id, exerciseId: item.exerciseId, round, loggedAt: now }
  const rest = restAfter(session, block, item, exercise)
  await db.transaction('rw', db.sets, db.sessions, async () => {
    await db.sets.add(set)
    await db.sessions.update(session.id, { restEndsAt: rest > 0 ? now + rest * 1000 : undefined })
  })
  return set
}

/** Finishing the last session completes the programme. */
export async function finishWorkout(db: GymDb, sessionId: string, date = todayIso(), now = Date.now()) {
  await db.transaction('rw', db.sessions, db.programmes, async () => {
    await db.sessions.update(sessionId, { status: 'done', completedDate: date, finishedAt: now, restEndsAt: undefined })
    const session = await db.sessions.get(sessionId)
    if (!session?.programmeId) return
    const all = await db.sessions.where('programmeId').equals(session.programmeId).toArray()
    if (all.every((s) => s.status === 'done' || s.status === 'skipped')) {
      await db.programmes.update(session.programmeId, { status: 'archived' })
    }
  })
}

/** Puts a session back as if it was never started. */
export async function discardWorkout(db: GymDb, sessionId: string) {
  await db.transaction('rw', db.sets, db.sessions, async () => {
    await db.sets.where('sessionId').equals(sessionId).delete()
    await db.sessions.update(sessionId, { status: 'planned', startedAt: undefined, restEndsAt: undefined })
  })
}

export const WORK_REST_PRESETS = [
  { label: '1:3', restPerWork: 3 },
  { label: '1:2', restPerWork: 2 },
  { label: '1:1', restPerWork: 1 },
  { label: '2:1', restPerWork: 0.5 },
]
