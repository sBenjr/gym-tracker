import { useRoute } from './router'
import { ExerciseEditor, ExercisesScreen } from './screens/ExercisesScreen'
import { ProgrammeScreen, ProgrammesScreen, SessionScreen, SlotScreen } from './screens/ProgrammeScreens'
import { SettingsScreen } from './screens/SettingsScreen'
import { TodayScreen } from './screens/TodayScreen'
import { WorkoutScreen } from './screens/WorkoutScreen'

export function App() {
  const [page, id, section, childId] = useRoute()
  if (page === 'workout' && id) return <WorkoutScreen id={id} />
  if (page === 'programmes') return <ProgrammesScreen />
  if (page === 'exercises') return id ? <ExerciseEditor id={decodeURIComponent(id)} /> : <ExercisesScreen />
  if (page === 'settings') return <SettingsScreen />
  if (page === 'session' && id) return <SessionScreen id={id} />
  if (page === 'programme' && id) {
    return section === 'slot' && childId ? <SlotScreen programmeId={id} slotId={childId} /> : <ProgrammeScreen id={id} />
  }
  return <TodayScreen />
}
