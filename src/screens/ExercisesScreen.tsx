import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db'
import { newExercise, searchExercises } from '../domain/exercises'
import { CATEGORIES, EQUIPMENT, EXERCISE_KINDS, LOAD_TYPES, MEASURES, labelFor } from '../labels'
import { navigate } from '../router'
import type { Exercise, ExerciseKind } from '../types'
import { BottomNav, Chips, ConfirmButton, Header, Stepper, TextField } from '../ui'

type Filter = ExerciseKind | 'check' | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...EXERCISE_KINDS,
  { value: 'check', label: 'To check' },
]

export function ExerciseList({
  query,
  filter,
  onPick,
}: {
  query: string
  filter: Filter
  onPick: (exercise: Exercise) => void
}) {
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  if (!exercises) return null
  const results = searchExercises(exercises, query, filter === 'all' ? undefined : filter)
  return (
    <>
      <p className="count">
        {results.length} {results.length === 1 ? 'exercise' : 'exercises'}
      </p>
      <ul className="list">
        {results.map((exercise) => (
          <li key={exercise.id}>
            <button type="button" className="list-row" onClick={() => onPick(exercise)}>
              <span className="row-title">{exercise.name}</span>
              <span className="row-meta">
                {labelFor(EQUIPMENT, exercise.equipment)}
                {exercise.category ? ` · ${labelFor(CATEGORIES, exercise.category)}` : ''}
                {exercise.check && <span className="flag">Check</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ExercisesScreen() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const addExercise = async () => {
    const name = query.trim() || 'New exercise'
    let exercise = newExercise(name)
    if (await db.exercises.get(exercise.id)) exercise = { ...exercise, id: `${exercise.id}-${Date.now()}` }
    await db.exercises.add(exercise)
    navigate(`/exercises/${encodeURIComponent(exercise.id)}`)
  }

  return (
    <div className="screen with-nav">
      <Header title="Exercises" />
      <main>
        <input
          className="search"
          type="search"
          placeholder="Search, e.g. db bench"
          aria-label="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
        <ExerciseList query={query} filter={filter} onPick={(e) => navigate(`/exercises/${encodeURIComponent(e.id)}`)} />
      </main>
      <div className="action-bar above-nav">
        <button type="button" className="button primary" onClick={addExercise}>
          {query.trim() ? `Add "${query.trim()}"` : 'Add exercise'}
        </button>
      </div>
      <BottomNav active="exercises" />
    </div>
  )
}

export function ExerciseEditor({ id }: { id: string }) {
  const exercise = useLiveQuery(() => db.exercises.get(id), [id])
  if (!exercise) return null
  const update = (changes: Partial<Exercise>) => db.exercises.update(id, changes)
  const weighted = exercise.load !== 'bodyweight'

  return (
    <div className="screen">
      <Header title="Exercise" back="/exercises" />
      <main className="form">
        {exercise.check && (
          <div className="notice">
            <strong>Please check this one.</strong> {exercise.check}
            <button type="button" className="button small" onClick={() => db.exercises.update(id, { check: undefined })}>
              It's correct
            </button>
          </div>
        )}
        <TextField label="Name" value={exercise.name} onChange={(name) => update({ name })} />
        <TextField
          label="Your cues and notes"
          multiline
          placeholder="Shown whenever you do this exercise, e.g. slow on the way down"
          value={exercise.notes ?? ''}
          onChange={(notes) => update({ notes })}
        />
        <Chips label="Type" options={EXERCISE_KINDS} value={exercise.kind} onChange={(kind) => update({ kind })} />
        {exercise.kind === 'strength' && (
          <Chips
            label="Category"
            options={CATEGORIES}
            value={exercise.category}
            onChange={(category) => update({ category })}
          />
        )}
        <Chips label="Equipment" options={EQUIPMENT} value={exercise.equipment} onChange={(equipment) => update({ equipment })} />
        <Chips label="Weight" options={LOAD_TYPES} value={exercise.load} onChange={(load) => update({ load })} />
        {exercise.load === 'assisted' && (
          <p className="hint">Less assistance means you're stronger, so suggestions will go down, not up.</p>
        )}
        <Chips label="Measured by" options={MEASURES} value={exercise.measure} onChange={(measure) => update({ measure })} />
        {weighted && (
          <Stepper
            label="Weight step"
            suffix="kg"
            step={0.25}
            max={50}
            value={exercise.incrementKg}
            onChange={(incrementKg) => update({ incrementKg })}
          />
        )}
        {exercise.load === 'weighted' && (
          <Stepper
            label="Bar or machine weight"
            suffix="kg"
            step={2.5}
            max={200}
            value={exercise.baseWeightKg ?? 0}
            onChange={(baseWeightKg) => update({ baseWeightKg })}
          />
        )}
        <Stepper
          label="Rest"
          suffix="sec"
          step={15}
          max={600}
          value={exercise.restSec}
          onChange={(restSec) => update({ restSec })}
        />
        {exercise.kind !== 'mobility' && (
          <p className="hint">Hyrox sessions use 90 seconds instead, unless you change it in the session.</p>
        )}
        {exercise.aliases.length > 0 && (
          <div>
            <span className="field-label">Also found by searching</span>
            <p className="hint">{exercise.aliases.map((a) => a.replace(/\s*\.\.\.$/, '')).join(', ')}</p>
          </div>
        )}
        <ConfirmButton
          label={exercise.archived ? 'Restore exercise' : 'Archive exercise'}
          confirmLabel="Tap again to confirm"
          className="button"
          onConfirm={async () => {
            await update({ archived: !exercise.archived })
            navigate('/exercises')
          }}
        />
      </main>
    </div>
  )
}
