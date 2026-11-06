import { describe, expect, it } from 'vitest'
import type { Block, Programme, SessionPlan } from '../types'
import { newExercise } from './exercises'
import {
  applyDeload,
  applyToRemaining,
  copyProgramme,
  formatTarget,
  generateSessions,
  linkWithNext,
  newBlock,
  newProgramme,
  newSessionPlan,
  nextMonday,
  previewWeeks,
  regenerateSessions,
  restSecFor,
  standardDraft,
  unlink,
} from './programme'

const squat = newExercise('Smith Full Squat', { equipment: 'smith' })
const row = newExercise('Cable Seated Row', { equipment: 'cable' })

const plan = (name: string, ...blocks: Block[]): SessionPlan => ({ ...newSessionPlan(name), blocks })
const programme = (overrides: Partial<Programme>): Programme =>
  newProgramme({ startDate: '2026-11-09', ...overrides })

describe('generateSessions', () => {
  it('creates length x sessions-per-week sessions on Mon/Wed/Fri by default', () => {
    const p = programme({ rotation: [plan('A'), plan('B'), plan('C')] })
    const sessions = generateSessions(p)
    expect(sessions).toHaveLength(24)
    expect(sessions.slice(0, 3).map((s) => s.plannedDate)).toEqual(['2026-11-09', '2026-11-11', '2026-11-13'])
    expect(sessions[3].plannedDate).toBe('2026-11-16')
  })

  it('carries a 4-session rotation across a 3-day week, as in May 2025', () => {
    const p = programme({ rotation: ['Chest', 'Shoulders', 'Back', 'Legs'].map((n) => plan(n)) })
    const names = generateSessions(p).map((s) => s.name)
    expect(names.slice(0, 6)).toEqual(['Chest', 'Shoulders', 'Back', 'Legs', 'Chest', 'Shoulders'])
    expect(previewWeeks(p)).toEqual([
      ['Chest', 'Shoulders', 'Back'],
      ['Legs', 'Chest', 'Shoulders'],
    ])
  })

  it('supports the Hyrox shape: 6 sessions a week for 13 weeks', () => {
    const p = programme({
      lengthWeeks: 13,
      sessionsPerWeek: 6,
      deloadEnabled: false,
      rotation: ['A', 'Run', 'WOD', 'Easy', 'B', 'Long'].map((n) => plan(n)),
    })
    const sessions = generateSessions(p)
    expect(sessions).toHaveLength(78)
    expect(sessions.every((s) => !s.isDeload)).toBe(true)
    expect(sessions[5].plannedDate).toBe('2026-11-14')
  })

  it('makes the final week the deload at any length, and can be switched off', () => {
    const rotation = [plan('A', newBlock(squat))]
    const twelve = generateSessions(programme({ lengthWeeks: 12, rotation }))
    expect(twelve.filter((s) => s.isDeload).map((s) => s.weekNumber)).toEqual([12, 12, 12])
    expect(twelve.at(-1)?.blocks[0].rounds).toBe(2)
    expect(twelve[0].blocks[0].rounds).toBe(3)
    expect(generateSessions(programme({ rotation, deloadEnabled: false })).some((s) => s.isDeload)).toBe(false)
  })

  it('returns nothing without sessions in the rotation', () => {
    expect(generateSessions(programme({ rotation: [] }))).toEqual([])
  })
})

describe('standardDraft', () => {
  it('starts as 8 weeks of two strength sessions and one Hyrox session, finishing with a deload', () => {
    const draft = standardDraft()
    expect(draft).toMatchObject({ lengthWeeks: 8, sessionsPerWeek: 3, deloadEnabled: true })
    expect(draft.rotation.map((s) => s.type)).toEqual(['strength', 'strength', 'hyrox'])
  })
})

describe('applyDeload', () => {
  it('halves rounds rounding up, and takes single timed efforts to about 70%', () => {
    const sled = newBlock(newExercise('Sled Push', { kind: 'conditioning', measure: 'seconds' }))
    sled.items[0].target = { measure: 'seconds', min: 900, max: 900 }
    const [strength, timed] = applyDeload([{ ...newBlock(squat), rounds: 5 }, sled])
    expect(strength.rounds).toBe(3)
    expect(timed.items[0].target.max).toBe(630)
  })
})

describe('supersets', () => {
  it('links two exercises and splits them again without losing targets', () => {
    const blocks = [newBlock(squat), newBlock(row)]
    const linked = linkWithNext(blocks, 0)
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ kind: 'superset', rounds: 3, restSec: 45 })
    expect(linkWithNext(blocks, 0, 90)[0].restSec).toBe(90)
    expect(linked[0].items.map((i) => i.exerciseId)).toEqual([squat.id, row.id])
    const split = unlink(linked, 0)
    expect(split.map((b) => b.kind)).toEqual(['straight', 'straight'])
    expect(split.every((b) => b.rounds === 3)).toBe(true)
  })
})

describe('restSecFor', () => {
  it('rests 45 seconds in strength sessions and 90 in Hyrox, for the same exercise', () => {
    const block = newBlock(squat)
    expect(squat.restSec).toBe(45)
    expect(restSecFor('strength', block, squat)).toBe(45)
    expect(restSecFor('hyrox', block, squat)).toBe(90)
  })

  it('uses a rest set in the plan, and an edited exercise rest outside Hyrox', () => {
    expect(restSecFor('hyrox', { ...newBlock(squat), restSec: 60 }, squat)).toBe(60)
    expect(restSecFor('strength', newBlock(squat), { ...squat, restSec: 75 })).toBe(75)
  })

  it('keeps stretches short even in a Hyrox session', () => {
    const stretch = newExercise('Open Book Stretch', { kind: 'mobility' })
    expect(restSecFor('hyrox', newBlock(stretch), stretch)).toBe(30)
  })
})

describe('editing an active programme', () => {
  it('keeps started and finished sessions when regenerating', () => {
    const p = programme({ rotation: [plan('A'), plan('B'), plan('C')] })
    const sessions = generateSessions(p)
    sessions[0].status = 'done'
    sessions[0].notes = 'Felt strong'
    const rebuilt = regenerateSessions({ ...p, deloadEnabled: false }, sessions)
    expect(rebuilt[0].notes).toBe('Felt strong')
    expect(rebuilt).toHaveLength(24)
    expect(rebuilt.some((s) => s.isDeload)).toBe(false)
  })

  it('applies an edit only to later unstarted sessions of the same rotation entry', () => {
    const a = plan('Legs', newBlock(squat))
    const p = programme({ rotation: [a, plan('Push'), plan('Pull')] })
    const sessions = generateSessions(p)
    const edited = { ...sessions[3], name: 'Legs v2', blocks: [newBlock(row)] }
    const changes = applyToRemaining(edited, sessions)
    expect(changes.map((s) => s.weekNumber)).toEqual([3, 4, 5, 6, 7, 8])
    expect(changes.every((s) => s.name === 'Legs v2')).toBe(true)
    expect(changes.at(-1)?.isDeload).toBe(true)
  })
})

describe('copyProgramme', () => {
  it('makes an independent draft', () => {
    const source = programme({ status: 'template', name: 'Past plan', rotation: [plan('A', newBlock(squat))] })
    const copy = copyProgramme(source, 'New block')
    expect(copy).toMatchObject({ status: 'draft', name: 'New block' })
    expect(copy.id).not.toBe(source.id)
    copy.rotation[0].blocks[0].rounds = 9
    expect(source.rotation[0].blocks[0].rounds).toBe(3)
  })
})

describe('formatTarget', () => {
  it('reads the way the plans are written', () => {
    expect(formatTarget({ measure: 'reps', min: 8, max: 8, rir: 2 }, 3)).toBe('3 x 8')
    expect(formatTarget({ measure: 'reps', min: 6, max: 8 }, 3)).toBe('3 x 6-8')
    expect(formatTarget({ measure: 'metres', min: 20, max: 20 }, 3)).toBe('3 x 20m')
    expect(formatTarget({ measure: 'seconds', min: 30, max: 30, perSide: true }, 3)).toBe('3 x 30s')
    expect(formatTarget({ measure: 'seconds', min: 20, max: 40 })).toBe('20-40s')
    expect(formatTarget({ measure: 'reps', min: 8, max: 8, perSide: true })).toBe('8 reps')
    expect(formatTarget({ measure: 'seconds', min: 900, max: 900 }, 1)).toBe('1 x 15 min')
    expect(formatTarget({ measure: 'metres', min: 50, max: 50, weightKg: 90 })).toBe('50m @ 90kg')
    expect(formatTarget({ measure: 'metres', min: 50, max: 50, weightKg: 70, goalKg: 164 })).toBe('50m @ 70kg, building to 164kg')
    expect(formatTarget({ measure: 'metres', min: 50, max: 50, goalKg: 70 })).toBe('50m, building to 70kg')
    expect(formatTarget({ measure: 'reps', min: 0, max: 0 }, 1)).toBe('Warm-up')
  })
})

describe('nextMonday', () => {
  it('finds the coming Monday, or today if it is Monday', () => {
    expect(nextMonday(new Date(2026, 10, 5))).toBe('2026-11-09')
    expect(nextMonday(new Date(2026, 10, 9))).toBe('2026-11-09')
  })
})
