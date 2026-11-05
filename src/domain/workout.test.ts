import { beforeEach, describe, expect, it } from 'vitest'
import { GymDb } from '../db'
import type { Block, Programme, Session, SetLog } from '../types'
import { newExercise } from './exercises'
import { generateSessions, linkWithNext, newBlock, newProgramme, newSessionPlan } from './programme'
import {
  discardWorkout,
  finishWorkout,
  formatDuration,
  formatLast,
  formatSet,
  lastPerformance,
  logSet,
  nextRound,
  nextSession,
  nextSet,
  parseDuration,
  plannedSets,
  prefill,
  remainingSets,
  restAfter,
  startWorkout,
  swapSessions,
  todayIso,
} from './workout'

const curl = newExercise('Cable Curl', { equipment: 'cable' })
const pushdown = newExercise('Cable Pushdown', { equipment: 'cable' })
const squat = newExercise('Smith Full Squat', { equipment: 'smith' })
const stretch = newExercise('Open Book Stretch', { kind: 'mobility' })

function sessionWith(blocks: Block[], overrides: Partial<Session> = {}): Session {
  return { id: 's1', programmeId: 'p1', weekNumber: 1, order: 0, name: 'A', type: 'strength', blocks, isDeload: false, status: 'active', ...overrides }
}

const log = (session: Session, itemId: string, round: number, extra: Partial<SetLog> = {}): SetLog => ({
  id: `${session.id}-${itemId}-${round}`,
  sessionId: session.id,
  blockId: session.blocks[0]?.id ?? 'b',
  itemId,
  exerciseId: extra.exerciseId ?? 'ex',
  round,
  loggedAt: round,
  ...extra,
})

describe('working through a session', () => {
  it('alternates exercises in a superset, round by round', () => {
    const session = sessionWith(linkWithNext([newBlock(curl), newBlock(pushdown)], 0))
    const [a, b] = session.blocks[0].items
    expect(plannedSets(session).map((p) => [p.item.id, p.round])).toEqual([
      [a.id, 1], [b.id, 1], [a.id, 2], [b.id, 2], [a.id, 3], [b.id, 3],
    ])
    expect(nextSet(session, [log(session, a.id, 1)])?.item.id).toBe(b.id)
  })

  it('leaves skipped exercises out, and allows any order', () => {
    const session = sessionWith([newBlock(squat), newBlock(curl)])
    const [first, second] = session.blocks
    session.skippedItemIds = [first.items[0].id]
    expect(remainingSets(session, [])).toHaveLength(3)
    expect(nextSet(session, [])?.block.id).toBe(second.id)
  })

  it('stays with the current exercise before moving on', () => {
    const session = sessionWith([newBlock(squat), newBlock(curl)])
    const second = session.blocks[1]
    const logs = [log(session, second.items[0].id, 1)]
    expect(nextSet(session, logs, second.id)?.block.id).toBe(second.id)
    expect(nextSet(session, logs)?.block.id).toBe(session.blocks[0].id)
  })

  it('counts past the plan for an extra set', () => {
    const logs = [1, 2, 3].map((r) => log(sessionWith([]), 'x', r))
    expect(nextRound('x', logs)).toBe(4)
    expect(nextRound('other', logs)).toBe(1)
  })

  it('logs HIIT once for the whole block', () => {
    const session = sessionWith([{ ...newBlock(curl), rounds: 8 }], { type: 'hiit' })
    expect(plannedSets(session)).toHaveLength(1)
  })
})

describe('restAfter', () => {
  it('rests after a straight set at the session rest', () => {
    const block = newBlock(squat)
    expect(restAfter(sessionWith([block]), block, block.items[0], squat)).toBe(45)
    expect(restAfter(sessionWith([block], { type: 'hyrox' }), block, block.items[0], squat)).toBe(90)
  })

  it('only rests after the last exercise of a superset', () => {
    const [block] = linkWithNext([newBlock(curl), newBlock(pushdown)], 0)
    const session = sessionWith([block])
    expect(restAfter(session, block, block.items[0], curl)).toBe(0)
    expect(restAfter(session, block, block.items[1], pushdown)).toBe(45)
  })

  it('does not rest after a warm-up or a single long effort', () => {
    const warmUp = newBlock(stretch)
    expect(restAfter(sessionWith([warmUp]), warmUp, warmUp.items[0], stretch)).toBe(0)
    const run = newExercise('Running', { kind: 'conditioning', measure: 'seconds' })
    const runBlock = newBlock(run)
    expect(restAfter(sessionWith([runBlock], { type: 'cardio' }), runBlock, runBlock.items[0], run)).toBe(0)
  })

  it('uses a rest planned for one exercise in a circuit', () => {
    const block = newBlock(curl)
    block.items[0].restAfterSec = 90
    expect(restAfter(sessionWith([block]), block, block.items[0], curl)).toBe(90)
  })
})

describe('lastPerformance', () => {
  const done = (id: string, date: string, extra: Partial<Session> = {}) =>
    sessionWith([], { id, status: 'done', completedDate: date, ...extra })
  const set = (sessionId: string, round: number, weightKg: number): SetLog => ({
    id: `${sessionId}-${round}`, sessionId, blockId: 'b', itemId: 'i', exerciseId: curl.id, round, weightKg, reps: 10, loggedAt: 0,
  })

  it('finds the latest finished session, ignoring this one', () => {
    const sets = [set('old', 1, 10), set('new', 1, 12), set('current', 1, 99)]
    const sessions = [done('old', '2026-01-01'), done('new', '2026-02-01'), sessionWith([], { id: 'current' })]
    expect(lastPerformance(curl.id, 'current', sets, sessions)?.sets[0].weightKg).toBe(12)
  })

  it('ignores deload sessions, so the next plan does not pre-fill at deload weights', () => {
    const sets = [set('normal', 1, 20), set('deload', 1, 14)]
    const sessions = [done('normal', '2026-01-01'), done('deload', '2026-02-01', { isDeload: true })]
    const last = lastPerformance(curl.id, 'x', sets, sessions)
    expect(last?.sets[0].weightKg).toBe(20)
    expect(last?.date).toBe('2026-01-01')
  })

  it('returns nothing the first time', () => {
    expect(lastPerformance(curl.id, 'x', [], [])).toBeNull()
  })
})

describe('prefill', () => {
  const block = newBlock(curl)
  const session = sessionWith([block])
  const target = { measure: 'reps' as const, min: 10, max: 12 }
  const lastSet = (round: number, weightKg: number, reps: number): SetLog => ({
    id: String(round), sessionId: 'old', blockId: block.id, itemId: 'i', exerciseId: curl.id, round, weightKg, reps, loggedAt: 0,
  })
  const buildUp = [lastSet(1, 16, 12), lastSet(2, 23, 12), lastSet(3, 28, 10)]

  it('copies the same set last time, so building up is kept', () => {
    expect(prefill(session, block, target, 1, buildUp, [])).toMatchObject({ weightKg: 16, reps: 12 })
    expect(prefill(session, block, target, 3, buildUp, [])).toMatchObject({ weightKg: 28, reps: 10 })
  })

  it('moves later sets by the same amount when today has changed', () => {
    const today = [{ ...lastSet(1, 18, 12), sessionId: 's1' }]
    expect(prefill(session, block, target, 2, buildUp, today).weightKg).toBe(25)
    expect(prefill(session, block, target, 3, buildUp, today).weightKg).toBe(30)
  })

  it('uses the plan the first time, then carries today forward', () => {
    expect(prefill(session, block, { ...target, weightKg: 70 }, 1, [], [])).toMatchObject({ weightKg: 70, reps: 10 })
    const today = [{ ...lastSet(1, 40, 11), sessionId: 's1' }]
    expect(prefill(session, block, target, 2, [], today)).toMatchObject({ weightKg: 40, reps: 11 })
  })

  it('leaves RIR and effort blank, so confirming never records a feeling you did not have', () => {
    const draft = prefill(session, block, target, 1, [{ ...lastSet(1, 16, 12), rir: 2, effort: 7 }], [])
    expect(draft.rir).toBeUndefined()
    expect(draft.effort).toBeUndefined()
  })

  it('fills time and distance targets', () => {
    expect(prefill(session, block, { measure: 'metres', min: 400, max: 400 }, 1, [], []).metres).toBe(400)
    expect(prefill(session, block, { measure: 'seconds', min: 20, max: 40 }, 1, [], []).seconds).toBe(40)
  })

  it('fills HIIT from the plan, assuming 1:3 until there is a rest set', () => {
    const hiit = sessionWith([block], { type: 'hiit' })
    expect(prefill(hiit, { ...block, rounds: 8 }, { measure: 'seconds', min: 30, max: 30 }, 1, [], [])).toMatchObject({ rounds: 8, workSec: 30, restSec: 90 })
  })
})

describe('showing what you did', () => {
  it('reads like the brief when the weight held', () => {
    expect(formatLast([8, 8, 7].map((reps) => ({ weightKg: 60, reps })))).toBe('60kg x 8, 8, 7')
  })

  it("shows each set's own weight when you built up", () => {
    expect(formatLast([{ weightKg: 16, reps: 12 }, { weightKg: 23, reps: 12 }])).toBe('16kg x 12, 23kg x 12')
  })

  it('handles bodyweight, distance and time', () => {
    expect(formatLast([{ reps: 10 }, { reps: 8 }])).toBe('10, 8 reps')
    expect(formatSet({ metres: 1000, seconds: 225 })).toBe('1000m in 3:45')
    expect(formatSet({ metres: 50, weightKg: 70 })).toBe('50m @ 70kg')
    expect(formatSet({ rounds: 8, workSec: 30, restSec: 60 })).toBe('8 rounds, 30s work, 60s rest')
    expect(formatSet({})).toBe('Done')
  })

  it('reads and writes durations', () => {
    expect(formatDuration(225)).toBe('3:45')
    expect(parseDuration('3:45')).toBe(225)
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('abc')).toBeNull()
  })
})

describe('choosing the session', () => {
  const programme = (): Programme =>
    newProgramme({ startDate: '2026-11-09', rotation: ['A', 'Hyrox', 'B'].map((n) => newSessionPlan(n)) })

  it('goes by order, so a missed session stays next', () => {
    const sessions = generateSessions(programme())
    expect(nextSession(sessions)?.name).toBe('A')
    sessions[0].status = 'done'
    sessions[1].status = 'skipped'
    expect(nextSession(sessions)?.name).toBe('B')
  })

  it('resumes an unfinished workout first', () => {
    const sessions = generateSessions(programme())
    sessions[2].status = 'active'
    expect(nextSession(sessions)?.name).toBe('B')
  })

  it('swaps two sessions, keeping the planned days in place', () => {
    const [a, b] = generateSessions(programme())
    const [movedA, movedB] = swapSessions(a, b)
    expect([movedA.order, movedB.order]).toEqual([1, 0])
    expect(movedA.plannedDate).toBe('2026-11-11')
    expect(movedB.plannedDate).toBe('2026-11-09')
  })

  it('uses the local date', () => {
    expect(todayIso(new Date(2026, 10, 5, 23, 30))).toBe('2026-11-05')
  })
})

describe('saving a workout', () => {
  let db: GymDb
  let dbNumber = 0
  beforeEach(() => {
    db = new GymDb(`workout-${dbNumber++}`)
  })

  async function started() {
    const p = newProgramme({ lengthWeeks: 1, sessionsPerWeek: 1, deloadEnabled: false, rotation: [{ ...newSessionPlan('A'), blocks: [newBlock(squat)] }] })
    const [session] = generateSessions(p)
    await db.programmes.add({ ...p, status: 'active' })
    await db.sessions.add(session)
    await startWorkout(db, session.id, 1000)
    return (await db.sessions.get(session.id))!
  }

  it('saves the set and starts the rest timer together', async () => {
    const session = await started()
    const [block] = session.blocks
    await logSet(db, session, block, block.items[0], 1, { weightKg: 60, reps: 8 }, squat, 5000)
    expect(await db.sets.where('sessionId').equals(session.id).count()).toBe(1)
    expect((await db.sessions.get(session.id))?.restEndsAt).toBe(5000 + 45 * 1000)
  })

  it('keeps sets when the database is reopened, as after a crash', async () => {
    const session = await started()
    const [block] = session.blocks
    await logSet(db, session, block, block.items[0], 1, { weightKg: 60, reps: 8 }, squat)
    const name = db.name
    db.close()
    const reopened = new GymDb(name)
    expect((await reopened.sets.toArray())[0]).toMatchObject({ weightKg: 60, reps: 8, round: 1 })
    expect((await reopened.sessions.get(session.id))?.status).toBe('active')
    db = reopened
  })

  it('finishes the session, and the programme with its last session', async () => {
    const session = await started()
    await finishWorkout(db, session.id, '2026-11-09')
    expect(await db.sessions.get(session.id)).toMatchObject({ status: 'done', completedDate: '2026-11-09' })
    expect((await db.programmes.get(session.programmeId!))?.status).toBe('archived')
  })

  it('can discard a workout started by mistake', async () => {
    const session = await started()
    const [block] = session.blocks
    await logSet(db, session, block, block.items[0], 1, { reps: 8 }, squat)
    await discardWorkout(db, session.id)
    expect(await db.sets.count()).toBe(0)
    expect((await db.sessions.get(session.id))?.status).toBe('planned')
  })
})
