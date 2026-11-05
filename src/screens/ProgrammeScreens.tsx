import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db'
import {
  applyToRemaining,
  copyProgramme,
  countExercises,
  formatDate,
  generateSessions,
  MAX_WEEKS,
  MIN_WEEKS,
  move,
  newId,
  newSessionPlan,
  previewWeeks,
  regenerateSessions,
  standardDraft,
  totalSessions,
} from '../domain/programme'
import { labelFor, SESSION_TYPES } from '../labels'
import { navigate } from '../router'
import type { Programme, Session, SessionPlan } from '../types'
import { BottomNav, ConfirmButton, Header, Stepper, TextField, Toggle } from '../ui'
import { PlanEditor, type EditablePlan } from './PlanEditor'

const startingDraft = async (source?: Programme) => {
  const draft = source ? copyProgramme(source, source.status === 'template' ? source.name : `${source.name} (copy)`) : standardDraft()
  await db.programmes.add(draft)
  navigate(`/programme/${draft.id}`)
}

function ProgrammeCard({ programme, detail }: { programme: Programme; detail: string }) {
  return (
    <li>
      <a className="list-row" href={`#/programme/${programme.id}`}>
        <span className="row-title">{programme.name}</span>
        <span className="row-meta">{detail}</span>
      </a>
    </li>
  )
}

const shape = (p: Programme) =>
  `${p.lengthWeeks} ${p.lengthWeeks === 1 ? 'week' : 'weeks'} · ${p.sessionsPerWeek} a week · ${p.rotation.length} different ${p.rotation.length === 1 ? 'session' : 'sessions'}`

export function ProgrammesScreen() {
  const programmes = useLiveQuery(() => db.programmes.toArray(), [])
  const sessions = useLiveQuery(() => db.sessions.toArray(), [])
  if (!programmes) return null
  const by = (status: Programme['status']) =>
    programmes.filter((p) => p.status === status).sort((a, b) => b.createdAt - a.createdAt)
  const active = by('active')
  const drafts = by('draft')
  const archived = by('archived')
  const templates = by('template')

  const activeDetail = (p: Programme) => {
    const next = sessions?.filter((s) => s.programmeId === p.id && s.status === 'planned').sort((a, b) => a.weekNumber - b.weekNumber || a.order - b.order)[0]
    return next ? `Week ${next.weekNumber} of ${p.lengthWeeks} · next: ${next.name}` : shape(p)
  }

  return (
    <div className="screen with-nav">
      <Header title="Programmes" />
      <main>
        {active.length > 0 && (
          <section>
            <h2 className="section-title">Current</h2>
            <ul className="list">{active.map((p) => <ProgrammeCard key={p.id} programme={p} detail={activeDetail(p)} />)}</ul>
          </section>
        )}
        {drafts.length > 0 && (
          <section>
            <h2 className="section-title">Drafts</h2>
            <ul className="list">{drafts.map((p) => <ProgrammeCard key={p.id} programme={p} detail={shape(p)} />)}</ul>
          </section>
        )}
        {templates.length > 0 && (
          <section>
            <h2 className="section-title">Plans to copy</h2>
            <ul className="list">{templates.map((p) => <ProgrammeCard key={p.id} programme={p} detail={shape(p)} />)}</ul>
          </section>
        )}
        {archived.length > 0 && (
          <section>
            <h2 className="section-title">Finished</h2>
            <ul className="list">{archived.map((p) => <ProgrammeCard key={p.id} programme={p} detail={shape(p)} />)}</ul>
          </section>
        )}
        {programmes.length === 0 && <p className="empty">Build your first programme, or load your past plans from Settings.</p>}
      </main>
      <div className="action-bar above-nav">
        <button type="button" className="button primary" onClick={() => startingDraft()}>
          New programme
        </button>
      </div>
      <BottomNav active="programmes" />
    </div>
  )
}

function RotationEditor({ programme, update }: { programme: Programme; update: (changes: Partial<Programme>) => void }) {
  const { rotation } = programme
  const addSession = async () => {
    const slot = newSessionPlan(`Session ${rotation.length + 1}`)
    await update({ rotation: [...rotation, slot] })
    navigate(`/programme/${programme.id}/slot/${slot.id}`)
  }
  return (
    <>
      <h2 className="section-title">Sessions in rotation</h2>
      <p className="hint">These repeat in order across the weeks, so a 4-session rotation carries over a 3-day week.</p>
      {rotation.length === 0 && <p className="empty">No sessions yet.</p>}
      <ol className="list">
        {rotation.map((slot, index) => (
          <li key={slot.id} className="slot">
            <a className="list-row" href={`#/programme/${programme.id}/slot/${slot.id}`}>
              <span className="row-title">{slot.name}</span>
              <span className="row-meta">
                {labelFor(SESSION_TYPES, slot.type)} · {countExercises(slot)} {countExercises(slot) === 1 ? 'exercise' : 'exercises'}
              </span>
            </a>
            <div className="slot-actions">
              <button type="button" className="icon-button" aria-label={`Move ${slot.name} earlier`} disabled={index === 0} onClick={() => update({ rotation: move(rotation, index, -1) })}>
                ↑
              </button>
              <button type="button" className="icon-button" aria-label={`Move ${slot.name} later`} disabled={index === rotation.length - 1} onClick={() => update({ rotation: move(rotation, index, 1) })}>
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="button" onClick={addSession}>
        Add session
      </button>
    </>
  )
}

function Preview({ programme }: { programme: Programme }) {
  const weeks = previewWeeks(programme)
  if (weeks.length === 0) return null
  return (
    <section className="preview">
      <h2 className="section-title">How it lays out</h2>
      {weeks.map((names, i) => (
        <p key={i}>
          <strong>Week {i + 1}:</strong> {names.join(', ')}
        </p>
      ))}
      <p className="hint">
        {totalSessions(programme)} sessions in total
        {programme.deloadEnabled && programme.lengthWeeks > 1 ? `, with week ${programme.lengthWeeks} as a deload.` : '.'}
      </p>
    </section>
  )
}

function ProgrammeSettings({ programme, update }: { programme: Programme; update: (changes: Partial<Programme>) => void }) {
  return (
    <>
      <div className="two-up">
        <Stepper label="Weeks" min={MIN_WEEKS} max={MAX_WEEKS} value={programme.lengthWeeks} onChange={(lengthWeeks) => update({ lengthWeeks })} />
        <Stepper label="Sessions a week" min={1} max={7} value={programme.sessionsPerWeek} onChange={(sessionsPerWeek) => update({ sessionsPerWeek })} />
      </div>
      <Toggle
        label="Finish with a deload week"
        hint="About half the sets, at 70-75% of your recent weights."
        checked={programme.deloadEnabled}
        onChange={(deloadEnabled) => update({ deloadEnabled })}
      />
    </>
  )
}

function ProgrammeBuilder({ programme }: { programme: Programme }) {
  const isTemplate = programme.status === 'template'
  const activeProgramme = useLiveQuery(() => db.programmes.where('status').equals('active').first(), [])
  const update = (changes: Partial<Programme>) => db.programmes.update(programme.id, changes)
  const emptySessions = programme.rotation.filter((slot) => slot.blocks.length === 0).map((slot) => slot.name)
  const ready = programme.rotation.length > emptySessions.length && !!programme.startDate

  const start = async () => {
    const started: Programme = { ...programme, status: 'active' }
    await db.transaction('rw', db.programmes, db.sessions, async () => {
      await db.programmes.put(started)
      await db.sessions.bulkAdd(generateSessions(started))
    })
    navigate(`/programme/${programme.id}`)
  }

  return (
    <div className="screen">
      <Header title={isTemplate ? 'Plan to copy' : 'Build programme'} back="/programmes" />
      <main className="form">
        <TextField label="Programme name" value={programme.name} onChange={(name) => update({ name })} />
        <TextField
          label="Goal or notes"
          placeholder="e.g. bigger arms, stronger core"
          value={programme.notes ?? ''}
          onChange={(notes) => update({ notes })}
        />
        <ProgrammeSettings programme={programme} update={update} />
        {!isTemplate && (
          <label className="text-field">
            <span className="field-label">Start date</span>
            <input type="date" value={programme.startDate ?? ''} onChange={(e) => update({ startDate: e.target.value })} />
          </label>
        )}
        <RotationEditor programme={programme} update={update} />
        <Preview programme={programme} />
        {!isTemplate && emptySessions.length > 0 && (
          <p className="hint">No exercises yet in: {emptySessions.join(', ')}.</p>
        )}
        {!isTemplate && (
          <ConfirmButton
            label="Delete draft"
            confirmLabel="Tap again to delete"
            onConfirm={async () => {
              await db.programmes.delete(programme.id)
              navigate('/programmes')
            }}
          />
        )}
      </main>
      <div className="action-bar">
        {isTemplate ? (
          <button type="button" className="button primary" onClick={() => startingDraft(programme)}>
            Copy into a new programme
          </button>
        ) : activeProgramme ? (
          <p className="hint centred">
            Finish <a href={`#/programme/${activeProgramme.id}`}>{activeProgramme.name}</a> before starting this one.
          </p>
        ) : (
          <button type="button" className="button primary" disabled={!ready} onClick={start}>
            Start programme
          </button>
        )}
      </div>
    </div>
  )
}

function ProgrammeOverview({ programme }: { programme: Programme }) {
  const sessions = useLiveQuery(() => db.sessions.where('programmeId').equals(programme.id).toArray(), [programme.id])
  if (!sessions) return null
  const isActive = programme.status === 'active'

  const update = async (changes: Partial<Programme>) => {
    const next = { ...programme, ...changes }
    await db.transaction('rw', db.programmes, db.sessions, async () => {
      await db.programmes.put(next)
      await db.sessions.where('programmeId').equals(programme.id).delete()
      await db.sessions.bulkAdd(regenerateSessions(next, sessions))
    })
  }

  const weeks = new Map<number, Session[]>()
  for (const session of [...sessions].sort((a, b) => a.weekNumber - b.weekNumber || a.order - b.order)) {
    weeks.set(session.weekNumber, [...(weeks.get(session.weekNumber) ?? []), session])
  }

  return (
    <div className="screen">
      <Header title={programme.name} back="/programmes" />
      <main className="form">
        {isActive && <ProgrammeSettings programme={programme} update={update} />}
        {[...weeks.entries()].map(([week, list]) => (
          <section key={week}>
            <h2 className="section-title">
              Week {week}
              {list[0].isDeload && <span className="flag">Deload</span>}
            </h2>
            <ul className="list">
              {list.map((session) => (
                <li key={session.id}>
                  <a className="list-row" href={`#/session/${session.id}`}>
                    <span className="row-title">{session.name}</span>
                    <span className="row-meta">
                      {formatDate(session.completedDate ?? session.plannedDate)} · {labelFor(SESSION_TYPES, session.type)} · {countExercises(session)} exercises
                      {session.status === 'done' && <span className="status">Done</span>}
                      {session.status === 'skipped' && <span className="status">Skipped</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button type="button" className="button" onClick={() => startingDraft(programme)}>
          Copy into a new programme
        </button>
        {isActive && (
          <ConfirmButton
            label="End programme"
            confirmLabel="Tap again to end it"
            onConfirm={async () => {
              await db.programmes.update(programme.id, { status: 'archived' })
              navigate('/programmes')
            }}
          />
        )}
      </main>
      {isActive && (
        <div className="action-bar">
          <button type="button" className="button primary" onClick={() => navigate('/')}>
            Go to Today
          </button>
        </div>
      )}
    </div>
  )
}

export function ProgrammeScreen({ id }: { id: string }) {
  const programme = useLiveQuery(() => db.programmes.get(id), [id])
  if (!programme) return null
  return programme.status === 'draft' || programme.status === 'template' ? (
    <ProgrammeBuilder programme={programme} />
  ) : (
    <ProgrammeOverview programme={programme} />
  )
}

/** Edits one entry in a programme's rotation. */
export function SlotScreen({ programmeId, slotId }: { programmeId: string; slotId: string }) {
  const programme = useLiveQuery(() => db.programmes.get(programmeId), [programmeId])
  const slot = programme?.rotation.find((s) => s.id === slotId)
  if (!programme || !slot) return null

  const updateSlot = (changes: Partial<EditablePlan>) =>
    db.programmes.update(programmeId, {
      rotation: programme.rotation.map((s) => (s.id === slotId ? { ...s, ...changes } : s)),
    })

  const removeSlot = async () => {
    await db.programmes.update(programmeId, { rotation: programme.rotation.filter((s) => s.id !== slotId) })
    navigate(`/programme/${programmeId}`)
  }

  const duplicateSlot = async () => {
    const copy: SessionPlan = { ...structuredClone(slot), id: newId(), name: `${slot.name} 2` }
    const index = programme.rotation.indexOf(slot)
    const rotation = [...programme.rotation]
    rotation.splice(index + 1, 0, copy)
    await db.programmes.update(programmeId, { rotation })
    navigate(`/programme/${programmeId}/slot/${copy.id}`)
  }

  return (
    <div className="screen">
      <Header title={slot.name} back={`/programme/${programmeId}`} />
      <main className="form">
        <PlanEditor plan={slot} onChange={updateSlot} />
        <button type="button" className="button" onClick={duplicateSlot}>
          Duplicate session
        </button>
        <ConfirmButton label="Remove session" confirmLabel="Tap again to remove" onConfirm={removeSlot} />
      </main>
    </div>
  )
}

/** Edits one dated session, with the option to carry the change forward. */
export function SessionScreen({ id }: { id: string }) {
  const session = useLiveQuery(() => db.sessions.get(id), [id])
  const [applied, setApplied] = useState(0)
  if (!session) return null
  const back = session.programmeId ? `/programme/${session.programmeId}` : '/programmes'

  const applyForward = async () => {
    if (!session.programmeId) return
    const all = await db.sessions.where('programmeId').equals(session.programmeId).toArray()
    const changes = applyToRemaining(session, all)
    const programme = await db.programmes.get(session.programmeId)
    await db.transaction('rw', db.programmes, db.sessions, async () => {
      await db.sessions.bulkPut(changes)
      if (programme && !session.isDeload) {
        await db.programmes.update(programme.id, {
          rotation: programme.rotation.map((s) =>
            s.id === session.slotId ? { ...s, name: session.name, type: session.type, blocks: structuredClone(session.blocks) } : s,
          ),
        })
      }
    })
    setApplied(changes.length)
  }

  return (
    <div className="screen">
      <Header title={session.name} back={back} />
      <main className="form">
        <p className="hint">
          Week {session.weekNumber}
          {session.plannedDate ? ` · ${formatDate(session.plannedDate)}` : ''}
          {session.isDeload ? ' · Deload week' : ''}
        </p>
        <PlanEditor
          plan={session}
          onChange={(changes) => {
            setApplied(0)
            return db.sessions.update(id, changes)
          }}
        />
        {session.slotId && !session.isDeload && (
          <>
            <button type="button" className="button" onClick={applyForward}>
              Use these changes for later "{session.name}" sessions
            </button>
            {applied > 0 && <p className="hint">Updated {applied} later sessions.</p>}
          </>
        )}
      </main>
    </div>
  )
}
