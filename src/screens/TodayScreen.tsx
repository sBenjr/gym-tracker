import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db'
import { formatDate, formatTarget } from '../domain/programme'
import { nextSession, startWorkout, swapSessions } from '../domain/workout'
import { labelFor, SESSION_TYPES } from '../labels'
import { navigate } from '../router'
import type { Session } from '../types'
import { BottomNav, ConfirmButton, Header } from '../ui'
import { BackupNudge } from './BackupSection'

const STATUS_LABEL: Partial<Record<Session['status'], string>> = { done: 'Done', skipped: 'Skipped', active: 'In progress' }

function ThisWeek({ sessions, week }: { sessions: Session[]; week: number }) {
  const list = sessions.filter((s) => s.weekNumber === week).sort((a, b) => a.order - b.order)
  const swap = async (a: Session, b: Session) => {
    await db.sessions.bulkPut(swapSessions(a, b))
  }
  return (
    <section>
      <h2 className="section-title">This week</h2>
      <ol className="list">
        {list.map((session, index) => {
          const previous = list[index - 1]
          const following = list[index + 1]
          return (
            <li key={session.id} className="slot">
              <div className="list-row static">
                <span className="row-title">{session.name}</span>
                <span className="row-meta">
                  {formatDate(session.plannedDate)}
                  {STATUS_LABEL[session.status] && <span className="status">{STATUS_LABEL[session.status]}</span>}
                </span>
              </div>
              {session.status === 'planned' && (
                <div className="slot-actions">
                  <button type="button" className="icon-button" aria-label={`Do ${session.name} earlier`} disabled={previous?.status !== 'planned'} onClick={() => swap(session, previous)}>
                    ↑
                  </button>
                  <button type="button" className="icon-button" aria-label={`Do ${session.name} later`} disabled={following?.status !== 'planned'} onClick={() => swap(session, following)}>
                    ↓
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function TodayScreen() {
  const data = useLiveQuery(async () => {
    const programme = await db.programmes.where('status').equals('active').first()
    const sessions = programme ? await db.sessions.where('programmeId').equals(programme.id).toArray() : []
    return { programme, sessions }
  }, [])
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  const byId = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e])), [exercises])
  if (!data) return null
  const { programme, sessions } = data
  const session = nextSession(sessions)

  if (!programme || !session) {
    return (
      <div className="screen with-nav">
        <Header title="Today" />
        <main>
          <p className="empty">No programme is running. Start one, or copy a plan, from Programmes.</p>
          <button type="button" className="button primary" onClick={() => navigate('/programmes')}>
            Go to Programmes
          </button>
          <BackupNudge />
        </main>
        <BottomNav active="today" />
      </div>
    )
  }

  const resuming = session.status === 'active'
  const open = async () => {
    if (!resuming) await startWorkout(db, session.id)
    navigate(`/workout/${session.id}`)
  }

  return (
    <div className="screen with-nav">
      <Header title="Today" />
      <main className="form">
        <section className="today-card">
          <p className="row-meta">
            {programme.name} · Week {session.weekNumber} of {programme.lengthWeeks}
            {session.isDeload && <span className="flag">Deload</span>}
          </p>
          <h2 className="today-name">{session.name}</h2>
          <p className="row-meta">
            {labelFor(SESSION_TYPES, session.type)}
            {session.plannedDate ? ` · ${formatDate(session.plannedDate)}` : ''}
          </p>
          {session.notes && <p className="hint">{session.notes}</p>}
          <ul className="plain-list">
            {session.blocks.flatMap((block) =>
              block.items.map((item) => (
                <li key={item.id}>
                  <span>{byId.get(item.exerciseId)?.name ?? 'Unknown exercise'}</span>
                  <span className="hint">{formatTarget(item.target, block.rounds)}</span>
                </li>
              )),
            )}
          </ul>
        </section>
        <BackupNudge />
        <ThisWeek sessions={sessions} week={session.weekNumber} />
        {!resuming && (
          <ConfirmButton
            label={`Skip ${session.name}`}
            confirmLabel="Tap again to skip"
            className="button"
            onConfirm={() => db.sessions.update(session.id, { status: 'skipped' })}
          />
        )}
      </main>
      <div className="action-bar above-nav">
        <button type="button" className="button primary" onClick={open}>
          {resuming ? 'Resume workout' : `Start ${session.name}`}
        </button>
      </div>
      <BottomNav active="today" />
    </div>
  )
}
