import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../db'
import { defaultTarget, formatDate, formatTarget, newBlock } from '../domain/programme'
import {
  discardWorkout,
  findItem,
  finishWorkout,
  formatDuration,
  formatLast,
  formatSet,
  isTickOnly,
  lastPerformance,
  logSet,
  nextRound,
  nextSet,
  parseDuration,
  plannedSets,
  prefill,
  remainingSets,
  takesWeight,
  WORK_REST_PRESETS,
  type LastPerformance,
  type SetDraft,
} from '../domain/workout'
import { restOverAlert, unlockAudio, useNow, useWakeLock } from '../feedback'
import { navigate } from '../router'
import type { Block, BlockItem, Exercise, Measure, Session, SetLog } from '../types'
import { Chips, ConfirmButton, DurationField, Header, Stepper, TextField } from '../ui'
import { ExercisePicker } from './PlanEditor'

const EFFORT_CHIPS = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))

/** Tapping a chosen chip again clears it, because these answers are optional. */
const toggled = (current: number | undefined, value: number) => (current === value ? undefined : value)

type LastTimeResult = { value: LastPerformance | null } | undefined

function useLastTime(exerciseId: string, sessionId: string): LastTimeResult {
  return useLiveQuery(async () => {
    const sets = await db.sets.where('exerciseId').equals(exerciseId).toArray()
    const sessions = await db.sessions.bulkGet([...new Set(sets.map((s) => s.sessionId))])
    return { value: lastPerformance(exerciseId, sessionId, sets, sessions) }
  }, [exerciseId, sessionId])
}

function LastTime({ last }: { last: LastTimeResult }) {
  return (
    <p className="last-time">
      {last === undefined
        ? ' '
        : last.value
          ? `Last time${last.value.date ? `, ${formatDate(last.value.date)}` : ''}: ${formatLast(last.value.sets)}`
          : 'First time for this exercise'}
    </p>
  )
}

function RestBar({ session }: { session: Session }) {
  const endsAt = session.restEndsAt
  // Read the clock here: the ticking value can be up to half a second old just after a set is saved.
  const now = Date.now()
  if (!endsAt || endsAt <= now) return null
  return (
    <div className="rest-bar" role="timer" aria-label="Rest timer">
      <span className="rest-label">Rest</span>
      <span className="rest-time">{formatDuration(Math.ceil((endsAt - now) / 1000))}</span>
      <button type="button" className="button small" onClick={() => db.sessions.update(session.id, { restEndsAt: endsAt + 30000 })}>
        +30s
      </button>
      <button type="button" className="button small" onClick={() => db.sessions.update(session.id, { restEndsAt: undefined })}>
        Skip
      </button>
    </div>
  )
}

// ---------- Strength and Hyrox: a checklist of every set

const AMOUNT_LABEL: Record<Measure, string> = { reps: 'reps', seconds: 'sec', metres: 'm' }
const AMOUNT_FIELD = { reps: 'reps', seconds: 'seconds', metres: 'metres' } as const

/** What's typed in a set row, kept as text so a half-typed "22." isn't lost. */
interface RowText {
  weight: string
  amount: string
}

const asText = (n?: number) => (n === undefined || Number.isNaN(n) ? '' : String(n))

function parseWeight(text: string): number | undefined {
  const n = parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

function parseAmount(text: string, measure: Measure): number | undefined {
  if (measure === 'seconds') return parseDuration(text) ?? undefined
  const n = parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}

function ExerciseSets({
  session,
  block,
  item,
  exercise,
  logs,
  showTitle,
  onLogged,
  onSwap,
}: {
  session: Session
  block: Block
  item: BlockItem
  exercise?: Exercise
  logs: SetLog[]
  showTitle: boolean
  onLogged: (set: SetLog, block: Block) => void
  onSwap: (itemId: string) => void
}) {
  const last = useLastTime(item.exerciseId, session.id)
  const [rows, setRows] = useState<Record<number, RowText>>({})
  const [options, setOptions] = useState(false)
  const [failed, setFailed] = useState('')
  const name = exercise?.name ?? 'Unknown exercise'
  const { target } = item
  const measure = target.measure
  const field = AMOUNT_FIELD[measure]
  const tickOnly = isTickOnly(target, exercise)
  const weighted = !tickOnly && takesWeight(exercise)
  const mine = logs.filter((log) => log.itemId === item.id)
  const byRound = new Map(mine.map((log) => [log.round, log]))
  const skippedIds = session.skippedItemIds ?? []
  const skipped = skippedIds.includes(item.id)
  const rounds = Array.from({ length: Math.max(block.rounds, ...mine.map((log) => log.round)) }, (_, i) => i + 1)
  const lastSets = last?.value?.sets ?? []

  const fromSet = (set: SetDraft): RowText => ({ weight: asText(set.weightKg), amount: asText(set[field]) })
  const textFor = (round: number, current = rows): RowText =>
    current[round] ?? fromSet(byRound.get(round) ?? prefill(session, block, target, round, lastSets, mine))

  const draftFrom = (text: RowText): SetDraft => {
    const draft: SetDraft = {}
    if (tickOnly) return draft
    const amount = parseAmount(text.amount, measure)
    if (amount !== undefined) draft[field] = amount
    const weight = weighted ? parseWeight(text.weight) : undefined
    if (weight !== undefined) draft.weightKg = weight
    return draft
  }

  // If saving ever fails, say so on screen rather than leaving a tick that seems to do nothing.
  const attempt = async (what: string, action: () => Promise<void>) => {
    try {
      setFailed('')
      await action()
    } catch (error) {
      setFailed(`${what} didn't save (${error instanceof Error ? error.message : String(error)}). Please try again.`)
    }
  }

  const tick = (round: number) =>
    attempt(`Set ${round}`, async () => {
      try {
        unlockAudio()
      } catch {
        // No beep is better than no set.
      }
      const text = textFor(round)
      setRows((current) => ({ ...current, [round]: text }))
      onLogged(await logSet(db, session, block, item, round, draftFrom(text), exercise), block)
    })

  // Unticking keeps what was typed, and stops the rest that set started.
  const untick = (log: SetLog) =>
    attempt(`Set ${log.round}`, async () => {
      setRows((current) => ({ ...current, [log.round]: textFor(log.round, current) }))
      await db.transaction('rw', db.sets, db.sessions, async () => {
        await db.sets.delete(log.id)
        await db.sessions.update(session.id, { restEndsAt: undefined })
      })
    })

  const change = (round: number, key: keyof RowText, value: string) => {
    setRows((current) => {
      const next = { ...current, [round]: { ...textFor(round, current), [key]: value } }
      // A new weight carries on to the sets still to do. Reps stay as planned.
      if (key === 'weight') {
        for (const later of rounds) {
          if (later > round && !byRound.has(later)) next[later] = { ...textFor(later, current), weight: value }
        }
      }
      return next
    })
  }

  // A ticked set can still be corrected; the change saves when you leave the box.
  const save = async (round: number) => {
    const log = byRound.get(round)
    const text = rows[round]
    if (!log || !text) return
    const draft = draftFrom(text)
    const changes: Partial<SetLog> = { weightKg: draft.weightKg }
    changes[field] = draft[field]
    await attempt(`The change to set ${round}`, async () => void (await db.sets.update(log.id, changes)))
  }

  const setSkipped = (skip: boolean) =>
    db.sessions.update(session.id, {
      skippedItemIds: skip ? [...skippedIds, item.id] : skippedIds.filter((id) => id !== item.id),
    })

  const input = (round: number, key: keyof RowText, label: string, inputMode: 'decimal' | 'numeric') => (
    <input
      className="set-input"
      aria-label={`Set ${round} ${label}`}
      inputMode={inputMode}
      placeholder="–"
      value={textFor(round)[key]}
      onChange={(e) => change(round, key, e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => void save(round)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )

  return (
    <section className="exercise-sets" aria-label={name}>
      <div className="exercise-sets-head">
        <div className="exercise-sets-title">
          {/* A single exercise is already named on its card, so only a superset names each one. */}
          {showTitle ? (
            <>
              <h3>{name}</h3>
              <p className="hint">{formatTarget(target)}</p>
            </>
          ) : (
            !tickOnly && !skipped && <LastTime last={last} />
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Options for ${name}`}
          aria-expanded={options}
          onClick={() => setOptions(!options)}
        >
          ⋯
        </button>
      </div>
      {options && (
        <div className="action-grid">
          <button
            type="button"
            className="button small"
            onClick={() => {
              setOptions(false)
              onSwap(item.id)
            }}
          >
            Swap exercise
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => {
              setOptions(false)
              void setSkipped(!skipped)
            }}
          >
            {skipped ? 'Bring back' : 'Skip today'}
          </button>
          <HowToLink name={name} />
        </div>
      )}
      {target.note && <p className="hint">{target.note}</p>}
      {exercise?.notes && <p className="cue">{exercise.notes}</p>}
      {failed && (
        <p className="notice" role="alert">
          {failed}
        </p>
      )}
      {skipped ? (
        <p className="hint">Skipped today.</p>
      ) : (
        <>
          {showTitle && !tickOnly && <LastTime last={last} />}
          {/* Drawn straight away; the weights from last time fill in when they arrive. */}
          <div className={weighted ? 'set-table' : 'set-table single'}>
              {!tickOnly && (
                <div className="set-row set-head" aria-hidden="true">
                  <span>Set</span>
                  {weighted && <span>kg</span>}
                  <span>{AMOUNT_LABEL[measure]}</span>
                  <span />
                </div>
              )}
              {rounds.map((round) => {
                const log = byRound.get(round)
                return (
                  <div key={round} className={log ? 'set-row ticked' : 'set-row'}>
                    <span className="set-number">{round}</span>
                    {weighted && input(round, 'weight', 'weight', 'decimal')}
                    {tickOnly ? (
                      <span className="set-label">Tick when done</span>
                    ) : (
                      input(round, 'amount', AMOUNT_LABEL[measure], 'numeric')
                    )}
                    <button
                      type="button"
                      className={log ? 'tick on' : 'tick'}
                      aria-label={log ? `Untick set ${round}` : `Tick set ${round}`}
                      aria-pressed={!!log}
                      onClick={() => void (log ? untick(log) : tick(round))}
                    >
                      ✓
                    </button>
                  </div>
                )
              })}
          </div>
        </>
      )}
    </section>
  )
}

/** Opens a YouTube search for the exercise, which goes to the YouTube app on a phone. */
function HowToLink({ name }: { name: string }) {
  return (
    <a
      className="button small"
      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`how to do ${name} exercise`)}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      How to (YouTube)
    </a>
  )
}

function blockTitle(names: string[]): string {
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(' + ')
}

function BlockCard({
  session,
  block,
  byId,
  logs,
  open,
  onToggle,
  onLogged,
  onSwap,
}: {
  session: Session
  block: Block
  byId: Map<string, Exercise>
  logs: SetLog[]
  open: boolean
  onToggle: () => void
  onLogged: (set: SetLog, block: Block) => void
  onSwap: (itemId: string) => void
}) {
  const skipped = new Set(session.skippedItemIds ?? [])
  const planned = plannedSets({ ...session, blocks: [block] }).filter((p) => !skipped.has(p.item.id))
  const logged = new Set(logs.map((log) => `${log.itemId}-${log.round}`))
  const done = planned.filter((p) => logged.has(`${p.item.id}-${p.round}`)).length
  const grouped = block.items.length > 1
  const progress = planned.length === 0 ? 'Skipped' : done >= planned.length ? 'Done ✓' : `${done}/${planned.length}`
  return (
    <li data-block={block.id} className={`block-card${open ? ' open' : ''}${done >= planned.length ? ' complete' : ''}`}>
      <button type="button" className="block-header" aria-expanded={open} onClick={onToggle}>
        <span className="block-header-text">
          {grouped && (
            <span className="group-label">
              {block.kind === 'circuit' ? 'Circuit' : 'Superset'} · {block.rounds} rounds
            </span>
          )}
          <span className="row-title">{blockTitle(block.items.map((item) => byId.get(item.exerciseId)?.name ?? 'Unknown exercise'))}</span>
          {!grouped && <span className="hint">{formatTarget(block.items[0].target, block.rounds)}</span>}
        </span>
        <span className="block-progress">{progress}</span>
      </button>
      {open && (
        <div className="block-body">
          {block.items.map((item) => (
            <ExerciseSets
              key={item.id}
              session={session}
              block={block}
              item={item}
              exercise={byId.get(item.exerciseId)}
              logs={logs}
              showTitle={grouped}
              onLogged={onLogged}
              onSwap={onSwap}
            />
          ))}
        </div>
      )}
    </li>
  )
}

// ---------- Cardio and HIIT: one entry form at a time

function SetEntry({
  session,
  block,
  item,
  exercise,
  round,
  initial,
  previous,
  editing,
  onSave,
  onRepeat,
  onDelete,
  onCancel,
}: {
  session: Session
  block: Block
  item: BlockItem
  exercise?: Exercise
  round: number
  initial: SetDraft
  previous?: SetLog
  editing: boolean
  onSave: (draft: SetDraft) => void
  onRepeat?: () => void
  onDelete?: () => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<SetDraft>(initial)
  const [more, setMore] = useState(false)
  const set = (changes: Partial<SetDraft>) => setDraft((d) => ({ ...d, ...changes }))
  const { target } = item
  const tickOnly = isTickOnly(target, exercise)
  const hiit = session.type === 'hiit'
  const cardio = session.type === 'cardio'
  const conditioning = exercise?.kind === 'conditioning'

  const showWeight = !tickOnly && !hiit && takesWeight(exercise)
  const showReps = !tickOnly && !hiit && target.measure === 'reps'
  const showTime = !tickOnly && !hiit && (target.measure === 'seconds' || cardio || more || /time/i.test(target.note ?? ''))
  const showDistance = !tickOnly && !hiit && (target.measure === 'metres' || cardio)
  const showEffort = !tickOnly && (hiit || cardio || (more && conditioning))
  const showHeartRate = !tickOnly && (cardio || (more && conditioning))
  const canShowMore = !tickOnly && !hiit && !cardio

  const save = () => {
    unlockAudio()
    onSave({
      ...draft,
      weightKg: showWeight ? draft.weightKg || undefined : undefined,
      metres: draft.metres || undefined,
      seconds: draft.seconds || undefined,
    })
  }

  return (
    <div className="form entry">
      {hiit && (
        <>
          <Stepper label="Rounds" min={1} max={50} value={draft.rounds ?? 1} onChange={(rounds) => set({ rounds })} />
          <div className="two-up">
            <Stepper label="Work" suffix="sec" step={5} max={600} value={draft.workSec ?? 0} onChange={(workSec) => set({ workSec })} />
            <Stepper label="Rest" suffix="sec" step={5} max={600} value={draft.restSec ?? 0} onChange={(restSec) => set({ restSec })} />
          </div>
          <Chips
            label="Work to rest"
            options={WORK_REST_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
            value={WORK_REST_PRESETS.find((p) => (draft.workSec ?? 0) * p.restPerWork === draft.restSec)?.label}
            onChange={(label) => {
              const preset = WORK_REST_PRESETS.find((p) => p.label === label)
              if (preset) set({ restSec: Math.round((draft.workSec ?? 0) * preset.restPerWork) })
            }}
          />
        </>
      )}
      {showWeight && (
        <Stepper label="Weight" suffix="kg" step={exercise?.incrementKg || 2.5} max={999} value={draft.weightKg ?? 0} onChange={(weightKg) => set({ weightKg })} />
      )}
      {showReps && <Stepper label="Reps" max={200} value={draft.reps ?? 0} onChange={(reps) => set({ reps })} />}
      {showDistance && <Stepper label="Distance" suffix="m" step={25} max={100000} value={draft.metres ?? 0} onChange={(metres) => set({ metres })} />}
      {showTime && <DurationField label="Time" value={draft.seconds} onChange={(seconds) => set({ seconds })} />}
      {showEffort && (
        <Chips
          label="Effort, 1-10 (optional)"
          options={EFFORT_CHIPS}
          value={draft.effort}
          onChange={(value) => set({ effort: toggled(draft.effort, value) })}
        />
      )}
      {showHeartRate && (
        <Stepper label="Average heart rate" suffix="bpm" step={5} max={250} value={draft.avgHr ?? 0} onChange={(avgHr) => set({ avgHr: avgHr || undefined })} />
      )}
      {(more || draft.notes) && (
        <TextField label="Set note" value={draft.notes ?? ''} onChange={(notes) => set({ notes: notes || undefined })} />
      )}
      {!more && (
        <button type="button" className="link-button" onClick={() => setMore(true)}>
          {canShowMore ? 'More: time, effort, note' : 'Add a note'}
        </button>
      )}

      <div className="action-bar">
        <div className="entry-actions">
          {editing ? (
            <>
              <ConfirmButton label="Delete" confirmLabel="Tap again" className="button danger" onConfirm={() => onDelete?.()} />
              <button type="button" className="button" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="button primary" onClick={save}>
                Save
              </button>
            </>
          ) : (
            <>
              {previous && !tickOnly && !hiit && (
                <button type="button" className="button" onClick={onRepeat}>
                  Same again
                </button>
              )}
              <button type="button" className="button primary wide" onClick={save}>
                {round > (hiit ? 1 : block.rounds) ? 'Add extra set' : tickOnly || block.kind === 'circuit' ? 'Done' : 'Confirm set'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function positionLabel(session: Session, block: Block, round: number): string {
  if (session.type === 'hiit') return 'HIIT'
  const over = round > block.rounds
  if (block.items.length > 1) {
    const group = block.kind === 'circuit' ? 'Circuit' : 'Superset'
    return over ? `${group} · extra round` : `${group} · round ${round} of ${block.rounds}`
  }
  return over ? 'Extra set' : `Set ${round} of ${block.rounds}`
}

function FocusCard({
  session,
  block,
  item,
  exercise,
  logs,
  editing,
  setEditing,
  onLogged,
}: {
  session: Session
  block: Block
  item: BlockItem
  exercise?: Exercise
  logs: SetLog[]
  editing: SetLog | null
  setEditing: (set: SetLog | null) => void
  onLogged: (set: SetLog) => void
}) {
  const last = useLastTime(item.exerciseId, session.id)
  const today = logs.filter((log) => log.itemId === item.id).sort((a, b) => a.round - b.round)
  const round = editing ? editing.round : nextRound(item.id, logs)
  const previous = today.at(-1)
  const lastSets = last?.value?.sets ?? []

  const log = async (draft: SetDraft) => {
    onLogged(await logSet(db, session, block, item, round, draft, exercise))
  }

  return (
    <section className="focus-card">
      <p className="position">{positionLabel(session, block, round)}</p>
      <h2 className="focus-name">{exercise?.name ?? 'Unknown exercise'}</h2>
      <p className="target">Target {formatTarget(item.target, block.items.length > 1 ? undefined : block.rounds)}</p>
      {item.target.note && <p className="hint">{item.target.note}</p>}
      {exercise?.notes && <p className="cue">{exercise.notes}</p>}
      <LastTime last={last} />

      {today.length > 0 && (
        <ol className="logged">
          {today.map((set) => (
            <li key={set.id}>
              <button type="button" aria-label={`Edit set ${set.round}`} className={editing?.id === set.id ? 'selected' : ''} onClick={() => setEditing(set)}>
                <span className="logged-number">{set.round}</span>
                <span className="logged-detail">
                  {formatSet(set)}
                  {set.effort !== undefined ? ` · effort ${set.effort}` : ''}
                  {set.notes && <span className="hint">{set.notes}</span>}
                </span>
                <span aria-hidden="true">✓</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {last !== undefined && (
        <SetEntry
          key={editing ? editing.id : `${item.id}-${round}`}
          session={session}
          block={block}
          item={item}
          exercise={exercise}
          round={round}
          initial={editing ?? prefill(session, block, item.target, round, lastSets, today)}
          previous={previous}
          editing={!!editing}
          onSave={async (draft) => {
            if (editing) {
              await db.sets.put({ ...editing, ...draft })
              setEditing(null)
            } else {
              await log(draft)
            }
          }}
          onRepeat={() => {
            if (!previous) return
            unlockAudio()
            const { weightKg, reps, seconds, metres } = previous
            void log({ weightKg, reps, seconds, metres })
          }}
          onDelete={async () => {
            if (editing) await db.sets.delete(editing.id)
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function ExerciseRow({
  session,
  block,
  item,
  exercise,
  logs,
  current,
  onSelect,
  onSwap,
}: {
  session: Session
  block: Block
  item: BlockItem
  exercise?: Exercise
  logs: SetLog[]
  current: boolean
  onSelect: () => void
  onSwap: () => void
}) {
  const [options, setOptions] = useState(false)
  const skippedIds = session.skippedItemIds ?? []
  const skipped = skippedIds.includes(item.id)
  const done = logs.filter((log) => log.itemId === item.id).length
  const planned = plannedSets({ ...session, blocks: [block] }).filter((p) => p.item.id === item.id).length
  const status = skipped ? 'Skipped' : done >= planned ? 'Done' : `${done}/${planned}`
  const setSkipped = (skip: boolean) =>
    db.sessions.update(session.id, {
      skippedItemIds: skip ? [...skippedIds, item.id] : skippedIds.filter((id) => id !== item.id),
    })
  return (
    <div className={current ? 'exercise-row current' : 'exercise-row'}>
      <div className="exercise-row-main">
        <button type="button" className="exercise-select" onClick={onSelect}>
          <span className="row-title">{exercise?.name ?? 'Unknown exercise'}</span>
          <span className={status === 'Done' ? 'row-meta done' : 'row-meta'}>{status}</span>
        </button>
        <button type="button" className="icon-button" aria-label={`Options for ${exercise?.name ?? 'exercise'}`} aria-expanded={options} onClick={() => setOptions(!options)}>
          ⋯
        </button>
      </div>
      {options && (
        <div className="action-grid">
          <button
            type="button"
            className="button small"
            onClick={() => {
              setOptions(false)
              onSwap()
            }}
          >
            Swap exercise
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => {
              setOptions(false)
              void setSkipped(!skipped)
            }}
          >
            {skipped ? 'Bring back' : 'Skip today'}
          </button>
          {exercise && <HowToLink name={exercise.name} />}
        </div>
      )}
    </div>
  )
}

function FinishView({ session, logs, onBack }: { session: Session; logs: SetLog[]; onBack: () => void }) {
  const remaining = remainingSets(session, logs).length
  const minutes = session.startedAt ? Math.max(1, Math.round((Date.now() - session.startedAt) / 60000)) : 0
  return (
    <div className="screen">
      <Header title="Finish workout" />
      <main className="form">
        <section className="today-card">
          <h2 className="today-name">{session.name}</h2>
          <p className="row-meta">
            {logs.length} {logs.length === 1 ? 'set' : 'sets'} logged · {minutes} min
          </p>
          {remaining > 0 && <p className="hint">{remaining} planned {remaining === 1 ? 'set' : 'sets'} not logged, which is fine.</p>}
        </section>
        <TextField
          label="Session notes"
          multiline
          placeholder="How did it go?"
          value={session.notes ?? ''}
          onChange={(notes) => db.sessions.update(session.id, { notes })}
        />
        <button type="button" className="button" onClick={onBack}>
          Keep training
        </button>
        <ConfirmButton
          label="Discard this workout"
          confirmLabel="Tap again to delete its sets"
          onConfirm={async () => {
            await discardWorkout(db, session.id)
            navigate('/')
          }}
        />
      </main>
      <div className="action-bar">
        <button
          type="button"
          className="button primary"
          onClick={async () => {
            await finishWorkout(db, session.id)
            navigate('/')
          }}
        >
          Finish workout
        </button>
      </div>
    </div>
  )
}

/** Strength and Hyrox sessions are ticked off set by set; cardio and HIIT use one form per entry. */
const usesChecklist = (session: Session) => session.type !== 'cardio' && session.type !== 'hiit'

export function WorkoutScreen({ id }: { id: string }) {
  const session = useLiveQuery(() => db.sessions.get(id), [id])
  const logs = useLiveQuery(() => db.sets.where('sessionId').equals(id).toArray(), [id])
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  const byId = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e])), [exercises])
  const [focusItemId, setFocusItemId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SetLog | null>(null)
  // Which exercise is open in the checklist. Until you choose, it follows the next set to do.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined)
  const [scrollTarget, setScrollTarget] = useState<{ blockId: string | null; at: number } | null>(null)
  const firstScroll = useRef(false)
  const [finishing, setFinishing] = useState(false)
  const [picker, setPicker] = useState<string | 'add' | null>(null)
  const now = useNow()
  useWakeLock(session?.status === 'active')

  const restEndsAt = session?.restEndsAt
  useEffect(() => {
    if (restEndsAt && now >= restEndsAt) {
      restOverAlert()
      void db.sessions.update(id, { restEndsAt: undefined })
    }
  }, [id, now, restEndsAt])

  // Brings the opened exercise to the top of the screen, just under the header and rest timer.
  useEffect(() => {
    if (!scrollTarget) return
    // Wait a moment so a rest timer that has just started is counted in the header's height.
    const timer = setTimeout(() => {
      const element = scrollTarget.blockId ? document.querySelector(`[data-block="${scrollTarget.blockId}"]`) : null
      const header = document.querySelector('.workout-top')?.getBoundingClientRect().height ?? 0
      const top = element ? element.getBoundingClientRect().top + window.scrollY - header - 8 : 0
      window.scrollTo({ top: Math.max(0, top) })
    }, 120)
    return () => clearTimeout(timer)
  }, [scrollTarget])

  // When resuming part way through, start at the exercise you're on.
  useEffect(() => {
    if (firstScroll.current || !session || !logs || !usesChecklist(session)) return
    firstScroll.current = true
    const next = nextSet(session, logs)
    if (next && next.block.id !== session.blocks[0]?.id) setScrollTarget({ blockId: next.block.id, at: Date.now() })
  }, [session, logs])

  if (!session || !logs || !exercises) return null
  if (session.status !== 'active') {
    return (
      <div className="screen">
        <Header title={session.name} back="/" />
        <main>
          <p className="empty">This workout isn't in progress.</p>
        </main>
      </div>
    )
  }
  if (finishing) return <FinishView session={session} logs={logs} onBack={() => setFinishing(false)} />

  const upNext = nextSet(session, logs)
  const allDone = !upNext
  const openBlockId = openId === undefined ? (upNext?.block.id ?? null) : openId
  const showBlock = (blockId: string | null) => {
    setOpenId(blockId)
    setScrollTarget({ blockId, at: Date.now() })
  }

  // Once every set of the open exercise is ticked, the next one to do opens by itself.
  const afterTick = (set: SetLog, block: Block) => {
    const next = nextSet(session, [...logs, set], block.id)
    if (!next) showBlock(null)
    else if (next.block.id !== block.id) showBlock(next.block.id)
  }

  const chosen = focusItemId ? findItem(session, focusItemId) : null
  const focus = chosen ?? upNext

  const select = (itemId: string) => {
    setEditing(null)
    setFocusItemId(itemId)
    window.scrollTo(0, 0)
  }

  const pick = async (exercise: Exercise) => {
    if (picker === 'add') {
      const block = newBlock(exercise)
      await db.sessions.update(id, { blocks: [...session.blocks, block] })
      setFocusItemId(block.items[0].id)
      showBlock(block.id)
    } else if (picker) {
      // Sets already logged keep the exercise they were done on.
      await db.sessions.update(id, {
        blocks: session.blocks.map((block) => ({
          ...block,
          items: block.items.map((item) =>
            item.id === picker
              ? { ...item, exerciseId: exercise.id, target: exercise.measure === item.target.measure ? item.target : defaultTarget(exercise) }
              : item,
          ),
        })),
      })
    }
    setPicker(null)
  }

  const doneCard = (hint: string) => (
    <section className="today-card">
      <h2 className="today-name">All sets done</h2>
      <p className="hint">{hint}</p>
      <button type="button" className="button primary" onClick={() => setFinishing(true)}>
        Finish workout
      </button>
    </section>
  )

  return (
    <div className="screen workout">
      <div className="workout-top">
        <Header
          title={session.name}
          back="/"
          action={
            <>
              <span className="elapsed" aria-label="Time in workout">
                {session.startedAt ? formatDuration((now - session.startedAt) / 1000) : ''}
              </span>
              <button type="button" className="button small finish" onClick={() => setFinishing(true)}>
                Finish
              </button>
            </>
          }
        />
        <RestBar session={session} />
      </div>
      {usesChecklist(session) ? (
        <main>
          {allDone && doneCard('Open any exercise to add a set, or finish the workout.')}
          <ol className="checklist">
            {session.blocks.map((block) => (
              <BlockCard
                key={block.id}
                session={session}
                block={block}
                byId={byId}
                logs={logs}
                open={openBlockId === block.id}
                onToggle={() => (openBlockId === block.id ? setOpenId(null) : showBlock(block.id))}
                onLogged={afterTick}
                onSwap={setPicker}
              />
            ))}
          </ol>
          <button type="button" className="button add-exercise" onClick={() => setPicker('add')}>
            Add exercise
          </button>
        </main>
      ) : (
        <main>
          {allDone && !chosen && doneCard('Tap any exercise to add an extra set, or finish the workout.')}
          {focus && (!allDone || chosen) && (
            <FocusCard
              key={focus.item.id}
              session={session}
              block={focus.block}
              item={focus.item}
              exercise={byId.get(focus.item.exerciseId)}
              logs={logs}
              editing={editing}
              setEditing={setEditing}
              onLogged={(set) => {
                const next = nextSet(session, [...logs, set], focus.block.id)
                setFocusItemId(next?.item.id ?? null)
                window.scrollTo(0, 0)
              }}
            />
          )}

          <h2 className="section-title">All exercises</h2>
          <ol className="blocks">
            {session.blocks.map((block) => (
              <li key={block.id} className={block.items.length > 1 ? 'block grouped compact' : 'block'}>
                {block.items.length > 1 && (
                  <p className="group-label">
                    {block.kind === 'circuit' ? 'Circuit' : 'Superset'} · {block.rounds} rounds
                  </p>
                )}
                {block.items.map((item) => (
                  <ExerciseRow
                    key={item.id}
                    session={session}
                    block={block}
                    item={item}
                    exercise={byId.get(item.exerciseId)}
                    logs={logs}
                    current={focus?.item.id === item.id && (!allDone || !!chosen)}
                    onSelect={() => select(item.id)}
                    onSwap={() => setPicker(item.id)}
                  />
                ))}
              </li>
            ))}
          </ol>
          <button type="button" className="button add-exercise" onClick={() => setPicker('add')}>
            Add exercise
          </button>
        </main>
      )}
      {picker && <ExercisePicker onPick={pick} onClose={() => setPicker(null)} />}
    </div>
  )
}
