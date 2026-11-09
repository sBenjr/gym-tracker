import { useEffect, useState, type ReactNode } from 'react'
import { formatDuration, parseDuration } from './domain/workout'
import { navigate } from './router'

export function Header({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  return (
    <header className="header">
      {back && (
        <a className="icon-button" href={`#${back}`} aria-label="Back">
          ‹
        </a>
      )}
      <h1>{title}</h1>
      {action}
    </header>
  )
}

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  suffix,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100))
  const commit = () => {
    const parsed = parseFloat(draft)
    const next = Number.isFinite(parsed) ? clamp(parsed) : value
    setDraft(String(next))
    if (next !== value) onChange(next)
  }
  return (
    <div className="stepper">
      <span className="field-label">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <div className="stepper-row">
        <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
          −
        </button>
        <label className="stepper-value">
          <input
            aria-label={label}
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <button type="button" aria-label={`More ${label}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
          +
        </button>
      </div>
    </div>
  )
}

export function DurationField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | undefined
  onChange: (seconds: number | undefined) => void
}) {
  const shown = value ? formatDuration(value) : ''
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  const step = (value ?? 0) >= 600 ? 60 : 15
  const commit = () => {
    const parsed = parseDuration(draft)
    if (parsed === null) setDraft(shown)
    else if (parsed !== value) onChange(parsed || undefined)
  }
  return (
    <div className="stepper">
      <span className="field-label">{label} (min:sec)</span>
      <div className="stepper-row">
        <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(Math.max(0, (value ?? 0) - step) || undefined)} disabled={!value}>
          −
        </button>
        <label className="stepper-value">
          <input
            aria-label={label}
            placeholder="0:00"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <button type="button" aria-label={`More ${label}`} onClick={() => onChange((value ?? 0) + step)}>
          +
        </button>
      </div>
    </div>
  )
}

export function Chips<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: { value: T; label: string }[]
  value: T | undefined
  onChange: (value: T) => void
}) {
  return (
    <div className="chips-field">
      {label && <span className="field-label">{label}</span>}
      <div className="chips" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={String(option.value)}
            className={option.value === value ? 'chip selected' : 'chip'}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  // What you type shows straight away. When the value is saved to the database and read back,
  // waiting for it would make a phone keyboard drop letters.
  const [draft, setDraft] = useState<string | null>(null)
  const props = {
    value: draft ?? value,
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value)
      onChange(e.target.value)
    },
    onBlur: () => setDraft(null),
  }
  return (
    <label className="text-field">
      <span className="field-label">{label}</span>
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
    </label>
  )
}

/** Needs a second tap, which is safer than a pop-up when you are out of breath. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'button danger',
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      type="button"
      className={armed ? `${className} armed` : className}
      onClick={() => {
        if (armed) onConfirm()
        else setArmed(true)
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}

export const BottomNav = ({ active }: { active: string }) => (
  <nav className="bottom-nav" aria-label="Main">
    {[
      { path: '/', key: 'today', label: 'Today' },
      { path: '/programmes', key: 'programmes', label: 'Programmes' },
      { path: '/exercises', key: 'exercises', label: 'Exercises' },
      { path: '/settings', key: 'settings', label: 'Settings' },
    ].map((tab) => (
      <button
        type="button"
        key={tab.key}
        className={active === tab.key ? 'selected' : ''}
        aria-current={active === tab.key ? 'page' : undefined}
        onClick={() => navigate(tab.path)}
      >
        {tab.label}
      </button>
    ))}
  </nav>
)
