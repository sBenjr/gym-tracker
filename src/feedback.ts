import { useEffect, useState } from 'react'

let audio: AudioContext | null = null

/** Browsers only allow sound after a tap, so this runs each time you confirm a set. */
export function unlockAudio() {
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
}

export function restOverAlert() {
  navigator.vibrate?.([200, 100, 200])
  if (!audio) return
  const start = audio.currentTime
  for (const offset of [0, 0.25, 0.5]) {
    const tone = audio.createOscillator()
    const volume = audio.createGain()
    tone.frequency.value = 880
    volume.gain.value = 0.3
    tone.connect(volume).connect(audio.destination)
    tone.start(start + offset)
    tone.stop(start + offset + 0.15)
  }
}

export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Keeps the screen on during a workout, because timers and beeps aren't reliable once it locks. */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    let stopped = false
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
        if (stopped) void lock.release()
      } catch {
        // Refused, for example on low battery. The workout still saves as normal.
      }
    }
    // The browser drops the lock whenever the app leaves the screen.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [on])
}
