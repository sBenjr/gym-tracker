import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../db'
import { newExercise } from '../domain/exercises'
import {
  defaultTarget,
  formatTarget,
  linkWithNext,
  move,
  newBlock,
  newId,
  restSecFor,
  sessionRestSec,
  unlink,
} from '../domain/programme'
import { BLOCK_KINDS, EXERCISE_KINDS, MEASURES, SESSION_TYPES } from '../labels'
import type { Block, BlockItem, Exercise, ExerciseKind, Measure, SessionType, Target } from '../types'
import { Chips, Stepper, TextField, Toggle } from '../ui'
import { ExerciseList } from './ExercisesScreen'

export interface EditablePlan {
  name: string
  type: SessionType
  blocks: Block[]
  notes?: string
}

const AMOUNT_STEP: Record<Measure, number> = { reps: 1, seconds: 15, metres: 25 }
const AMOUNT_UNIT: Record<Measure, string> = { reps: '', seconds: 'sec', metres: 'm' }

function TargetEditor({
  target,
  exercise,
  onChange,
}: {
  target: Target
  exercise?: Exercise
  onChange: (target: Target) => void
}) {
  const range = target.min !== target.max
  const step = AMOUNT_STEP[target.measure]
  const unit = AMOUNT_UNIT[target.measure]
  return (
    <div className="form">
      <Chips
        label="Measured by"
        options={MEASURES}
        value={target.measure}
        onChange={(measure) => {
          const amount = measure === 'reps' ? 10 : measure === 'seconds' ? 60 : 400
          onChange({ ...target, measure, min: amount, max: amount })
        }}
      />
      <Toggle
        label="Use a range"
        hint={target.measure === 'reps' ? 'e.g. 6-8 reps' : 'e.g. 20-40 seconds'}
        checked={range}
        onChange={(on) => onChange({ ...target, min: on ? Math.max(1, target.max - step * 2) : target.max })}
      />
      {range && (
        <Stepper
          label="From"
          suffix={unit}
          step={step}
          min={1}
          max={target.max}
          value={target.min}
          onChange={(min) => onChange({ ...target, min })}
        />
      )}
      <Stepper
        label={range ? 'To' : target.measure === 'reps' ? 'Reps' : target.measure === 'seconds' ? 'Time' : 'Distance'}
        suffix={unit}
        step={step}
        min={range ? target.min : 0}
        value={target.max}
        onChange={(max) => onChange({ ...target, max, min: range ? Math.min(target.min, max) : max })}
      />
      {exercise?.load === 'weighted' && (
        <div className="two-up">
          <Stepper
            label="Start at"
            suffix="kg"
            step={exercise.incrementKg || 2.5}
            max={500}
            value={target.weightKg ?? 0}
            onChange={(weightKg) => onChange({ ...target, weightKg: weightKg || undefined })}
          />
          <Stepper
            label="Build to"
            suffix="kg"
            step={exercise.incrementKg || 2.5}
            max={500}
            value={target.goalKg ?? 0}
            onChange={(goalKg) => onChange({ ...target, goalKg: goalKg || undefined })}
          />
        </div>
      )}
      <TextField
        label="Plan note"
        placeholder="e.g. heavy, record time"
        value={target.note ?? ''}
        onChange={(note) => onChange({ ...target, note: note || undefined })}
      />
    </div>
  )
}

/** Settings for an exercise you add yourself, so a rower gets distance and time rather than kg and reps. */
const NEW_EXERCISE: Record<ExerciseKind, Partial<Exercise>> = {
  strength: { kind: 'strength' },
  conditioning: { kind: 'conditioning', equipment: 'cardio_machine', load: 'bodyweight', measure: 'metres' },
  mobility: { kind: 'mobility', equipment: 'bodyweight', load: 'bodyweight' },
}

const NEW_EXERCISE_CHOICES: { kind: ExerciseKind; label: string }[] = [
  { kind: 'strength', label: 'Strength: kg and reps' },
  { kind: 'conditioning', label: 'Conditioning: distance and time' },
  { kind: 'mobility', label: 'Mobility: tick when done' },
]

export function ExercisePicker({ onPick, onClose }: { onPick: (exercise: Exercise) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ExerciseKind | 'all'>('all')
  const createAndPick = async (kind: ExerciseKind) => {
    const name = query.trim()
    if (!name) return
    const exercise = newExercise(name, { ...NEW_EXERCISE[kind], check: 'Added while building a session; check the details.' })
    const existing = await db.exercises.get(exercise.id)
    if (!existing) await db.exercises.add(exercise)
    onPick(existing ?? exercise)
  }
  return (
    <div className="overlay" role="dialog" aria-label="Choose an exercise">
      <header className="header">
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h1>Choose an exercise</h1>
      </header>
      <main>
        <input
          className="search"
          type="search"
          autoFocus
          placeholder="Search, e.g. db bench"
          aria-label="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Chips options={[{ value: 'all' as const, label: 'All' }, ...EXERCISE_KINDS]} value={filter} onChange={setFilter} />
        {query.trim() && (
          <div className="create-new">
            <p className="hint">Not listed? Add "{query.trim()}" as:</p>
            {NEW_EXERCISE_CHOICES.map((choice) => (
              <button key={choice.kind} type="button" className="button" onClick={() => void createAndPick(choice.kind)}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
        <ExerciseList query={query} filter={filter} onPick={onPick} />
      </main>
    </div>
  )
}

function ItemRow({
  item,
  exercise,
  rounds,
  restSec,
  open,
  onToggle,
  onChange,
  children,
}: {
  item: BlockItem
  exercise?: Exercise
  rounds?: number
  restSec?: number
  open: boolean
  onToggle: () => void
  onChange: (item: BlockItem) => void
  children?: React.ReactNode
}) {
  return (
    <div className={open ? 'item open' : 'item'}>
      <button type="button" className="item-head" aria-expanded={open} onClick={onToggle}>
        <span className="row-title">{exercise?.name ?? 'Unknown exercise'}</span>
        <span className="row-meta">
          {formatTarget(item.target, rounds)}
          {restSec !== undefined ? ` · ${restSec}s rest` : ''}
          {item.restAfterSec ? ` · then ${item.restAfterSec}s rest` : ''}
        </span>
        {item.target.note && <span className="row-note">{item.target.note}</span>}
      </button>
      {open && (
        <div className="item-body">
          <TargetEditor target={item.target} exercise={exercise} onChange={(target) => onChange({ ...item, target })} />
          {children}
        </div>
      )}
    </div>
  )
}

export function PlanEditor({ plan, onChange }: { plan: EditablePlan; onChange: (changes: Partial<EditablePlan>) => void }) {
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  const byId = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e])), [exercises])
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ blockId: string; itemId: string } | 'add' | null>(null)
  const { blocks } = plan

  const setBlocks = (next: Block[]) => onChange({ blocks: next })
  const updateBlock = (index: number, changes: Partial<Block>) =>
    setBlocks(blocks.map((b, i) => (i === index ? { ...b, ...changes } : b)))
  const updateItem = (blockIndex: number, item: BlockItem) =>
    updateBlock(blockIndex, { items: blocks[blockIndex].items.map((it) => (it.id === item.id ? item : it)) })

  const pick = (exercise: Exercise) => {
    if (picker === 'add') {
      const block = newBlock(exercise)
      setBlocks([...blocks, block])
      setOpenItem(block.items[0].id)
    } else if (picker) {
      setBlocks(
        blocks.map((block) =>
          block.id !== picker.blockId
            ? block
            : {
                ...block,
                items: block.items.map((item) =>
                  item.id === picker.itemId
                    ? { ...item, exerciseId: exercise.id, target: { ...defaultTarget(exercise), ...keepAmounts(item.target, exercise) } }
                    : item,
                ),
              },
        ),
      )
    }
    setPicker(null)
  }

  const itemActions = (block: Block, blockIndex: number, item: BlockItem) => {
    const itemIndex = block.items.indexOf(item)
    const multi = block.items.length > 1
    return (
      <div className="action-grid">
        {multi ? (
          <>
            <button type="button" className="button small" disabled={itemIndex === 0} onClick={() => updateBlock(blockIndex, { items: move(block.items, itemIndex, -1) })}>
              Move up
            </button>
            <button type="button" className="button small" disabled={itemIndex === block.items.length - 1} onClick={() => updateBlock(blockIndex, { items: move(block.items, itemIndex, 1) })}>
              Move down
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button small" disabled={blockIndex === 0} onClick={() => setBlocks(move(blocks, blockIndex, -1))}>
              Move up
            </button>
            <button type="button" className="button small" disabled={blockIndex === blocks.length - 1} onClick={() => setBlocks(move(blocks, blockIndex, 1))}>
              Move down
            </button>
          </>
        )}
        <button type="button" className="button small" onClick={() => setPicker({ blockId: block.id, itemId: item.id })}>
          Swap exercise
        </button>
        <button
          type="button"
          className="button small"
          onClick={() =>
            updateBlock(blockIndex, {
              items: block.items.flatMap((it) => (it.id === item.id ? [it, { ...structuredClone(it), id: newId() }] : [it])),
              kind: block.kind === 'straight' ? 'superset' : block.kind,
            })
          }
        >
          Repeat exercise
        </button>
        {blockIndex < blocks.length - 1 && (
          <button type="button" className="button small" onClick={() => setBlocks(linkWithNext(blocks, blockIndex, sessionRestSec(plan.type)))}>
            Superset with next
          </button>
        )}
        <button
          type="button"
          className="button small danger"
          onClick={() => {
            const remaining = block.items.filter((it) => it.id !== item.id)
            setBlocks(
              remaining.length === 0
                ? blocks.filter((_, i) => i !== blockIndex)
                : blocks.map((b, i) =>
                    i === blockIndex
                      ? { ...b, items: remaining, kind: remaining.length === 1 ? 'straight' : b.kind }
                      : b,
                  ),
            )
          }}
        >
          Remove
        </button>
      </div>
    )
  }

  return (
    <>
      <TextField label="Session name" value={plan.name} onChange={(name) => onChange({ name })} />
      <Chips label="Session type" options={SESSION_TYPES} value={plan.type} onChange={(type) => onChange({ type })} />

      <h2 className="section-title">Exercises</h2>
      {blocks.length === 0 && <p className="empty">No exercises yet.</p>}
      <ol className="blocks">
        {blocks.map((block, blockIndex) => {
          const single = block.items.length === 1
          return (
            <li key={block.id} className={single ? 'block' : 'block grouped'}>
              {!single && (
                <div className="block-head">
                  <Chips options={BLOCK_KINDS} value={block.kind === 'straight' ? 'superset' : block.kind} onChange={(kind) => updateBlock(blockIndex, { kind })} />
                  <div className="two-up">
                    <Stepper label="Rounds" min={1} max={20} value={block.rounds} onChange={(rounds) => updateBlock(blockIndex, { rounds })} />
                    <Stepper label="Rest after round" suffix="sec" step={15} max={600} value={block.restSec ?? 0} onChange={(restSec) => updateBlock(blockIndex, { restSec })} />
                  </div>
                </div>
              )}
              {block.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  exercise={byId.get(item.exerciseId)}
                  rounds={single ? block.rounds : undefined}
                  restSec={
                    single && (block.rounds > 1 || block.restSec !== undefined)
                      ? restSecFor(plan.type, block, byId.get(item.exerciseId))
                      : undefined
                  }
                  open={openItem === item.id}
                  onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}
                  onChange={(next) => updateItem(blockIndex, next)}
                >
                  {single && (
                    <div className="two-up">
                      <Stepper label="Sets" min={1} max={20} value={block.rounds} onChange={(rounds) => updateBlock(blockIndex, { rounds })} />
                      <Stepper
                        label="Rest"
                        suffix="sec"
                        step={15}
                        max={600}
                        value={restSecFor(plan.type, block, byId.get(item.exerciseId))}
                        onChange={(restSec) => updateBlock(blockIndex, { restSec })}
                      />
                    </div>
                  )}
                  {itemActions(block, blockIndex, item)}
                </ItemRow>
              ))}
              {!single && (
                <details className="block-options">
                  <summary>Group options</summary>
                  <div className="action-grid">
                    <button type="button" className="button small" disabled={blockIndex === 0} onClick={() => setBlocks(move(blocks, blockIndex, -1))}>
                      Move group up
                    </button>
                    <button type="button" className="button small" disabled={blockIndex === blocks.length - 1} onClick={() => setBlocks(move(blocks, blockIndex, 1))}>
                      Move group down
                    </button>
                    <button type="button" className="button small" onClick={() => setBlocks(unlink(blocks, blockIndex))}>
                      Split up
                    </button>
                    {blockIndex < blocks.length - 1 && (
                      <button type="button" className="button small" onClick={() => setBlocks(linkWithNext(blocks, blockIndex, sessionRestSec(plan.type)))}>
                        Add next exercise
                      </button>
                    )}
                  </div>
                </details>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className="button" onClick={() => setPicker('add')}>
        Add exercise
      </button>
      <TextField
        label="Session notes"
        multiline
        placeholder="Anything to remember for this session"
        value={plan.notes ?? ''}
        onChange={(notes) => onChange({ notes })}
      />
      {picker &&<ExercisePicker onPick={pick} onClose={() => setPicker(null)} />}
    </>
  )
}

/** Keeps the sets and reps you planned when you swap to a similar exercise. */
function keepAmounts(target: Target, exercise: Exercise): Partial<Target> {
  return target.measure === exercise.measure ? { min: target.min, max: target.max, perSide: target.perSide, rir: target.rir, note: target.note } : {}
}
