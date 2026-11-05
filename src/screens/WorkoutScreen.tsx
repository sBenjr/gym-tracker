import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
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
  plannedSets,
  prefill,
  remainingSets,
  WORK_REST_PRESETS,
  type LastPerformance,
  type SetDraft,
} from '../domain/workout'
import { restOverAlert, unlockAudio, useNow, useWakeLock } from '../feedback'
import { navigate } from '../router'
import type { Block, BlockItem, Exercise, Session, SetLog } from '../types'
import { Chips, ConfirmButton, DurationField, Header, Stepper, TextField } from '../ui'
import { ExercisePicker } from './PlanEditor'

const RIR_CHIPS = [0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))
const EFFORT_CHIPS = Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))

/** Tapping a chosen chip again clears it, because these answers are optional. */
const toggled = (current: number | undefined, value: number) => (current === value ? undefined : value)

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
  const strengthSession = session.type === 'strength' && exercise?.kind === 'strength'

  const showWeight = !tickOnly && !hiit && exercise?.load !== 'bodyweight'
  const showReps = !tickOnly && !hiit && target.measure === 'reps'
  const showTime = !tickOnly && !hiit && (target.measure === 'seconds' || cardio || more || /time/i.test(target.note ?? ''))
  const showDistance = !tickOnly && !hiit && (target.measure === 'metres' || cardio)
  const showRir = !tickOnly && !hiit && target.measure === 'reps' && (strengthSession || more)
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
      {showRir && (
        <Chips
          label="Reps you could still have done (optional)"
          options={RIR_CHIPS}
          value={draft.rir}
          onChange={(value) => set({ rir: toggled(draft.rir, value) })}
        />
      )}
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
  const last = useLiveQuery(async (): Promise<{ value: LastPerformance | null }> => {
    const sets = await db.sets.where('exerciseId').equals(item.exerciseId).toArray()
    const sessions = await db.sessions.bulkGet([...new Set(sets.map((s) => s.sessionId))])
    return { value: lastPerformance(item.exerciseId, session.id, sets, sessions) }
  }, [item.exerciseId, session.id])

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

      <p className="last-time">
        {last === undefined
          ? ' '
          : last.value
            ? `Last time${last.value.date ? `, ${formatDate(last.value.date)}` : ''}: ${formatLast(last.value.sets)}`
            : 'First time for this exercise'}
      </p>

      {today.length > 0 && (
        <ol className="logged">
          {today.map((set) => (
            <li key={set.id}>
              <button type="button" aria-label={`Edit set ${set.round}`} className={editing?.id === set.id ? 'selected' : ''} onClick={() => setEditing(set)}>
                <span className="logged-number">{set.round}</span>
                <span className="logged-detail">
                  {formatSet(set)}
                  {set.rir !== undefined ? ` · RIR ${set.rir}` : ''}
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
            const { weightKg, reps, seconds, metres, rir } = previous
            void log({ weightKg, reps, seconds, metres, rir })
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

export function WorkoutScreen({ id }: { id: string }) {
  const session = useLiveQuery(() => db.sessions.get(id), [id])
  const logs = useLiveQuery(() => db.sets.where('sessionId').equals(id).toArray(), [id])
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  const byId = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e])), [exercises])
  const [focusItemId, setFocusItemId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SetLog | null>(null)
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

  const chosen = focusItemId ? findItem(session, focusItemId) : null
  const upNext = nextSet(session, logs)
  const focus = chosen ?? upNext
  const allDone = !upNext

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
      <main>
        {allDone && !chosen && (
          <section className="today-card">
            <h2 className="today-name">All sets done</h2>
            <p className="hint">Tap any exercise to add an extra set, or finish the workout.</p>
            <button type="button" className="button primary" onClick={() => setFinishing(true)}>
              Finish workout
            </button>
          </section>
        )}
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
      {picker && <ExercisePicker onPick={pick} onClose={() => setPicker(null)} />}
    </div>
  )
}
