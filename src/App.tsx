import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { TabBar } from './components/nav/TabBar'
import { ChildProvider, useChildren } from './hooks/useChildren'
import { PrefsProvider } from './hooks/usePrefs'
import { StorageUnitsSeeder } from './hooks/useStorageUnits'
import { PumpsSeeder } from './hooks/usePumpsSeeder'
import { MilkWindowsSync } from './hooks/useMilkWindowsSync'
import { TimeZoneSync } from './hooks/useTimeZoneSync'
import { useScrollToTop } from './hooks/useScrollToTop'
import { fetchProfile } from './lib/api/auth'
import { qk } from './lib/api/keys'
import { tokenStore } from './lib/api/client'
import { LoginPage } from './features/auth/LoginPage'
import { OnboardingPage } from './features/auth/OnboardingPage'
import { HomePage } from './features/home/HomePage'
import { TimerPage } from './features/timer/TimerPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { DoctorReportPage } from './features/reports/DoctorReportPage'
import { NapPage } from './features/nap/NapPage'
import { ChildPage } from './features/child/ChildPage'
import { MorePage } from './features/more/MorePage'
import { MilkPage } from './features/milk/MilkPage'
import { ContractionsPage } from './features/contractions/ContractionsPage'
import { SleepPlansPage } from './features/plans/SleepPlansPage'
import { InsightsPage } from './features/insights/InsightsPage'
import { Splash } from './components/ui/Splash'
import { ErrorScreen } from './components/ui/ErrorScreen'
import { UpdateBanner } from './components/ui/UpdateBanner'
import { PrintNotice } from './components/ui/PrintNotice'
import { describeApiError } from './lib/api/client'
import { setCurrentCaregiver } from './lib/caregiver'
import { useMyScreen } from './hooks/useMyScreen'
import { SimplePage } from './features/simple/SimplePage'
import { WhatsNewOnLaunch } from './features/whats-new/WhatsNew'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true },
  },
})

function RequireAuth() {
  const location = useLocation()
  const hasToken = Boolean(tokenStore.get())
  const profile = useQuery({ queryKey: qk.profile, queryFn: fetchProfile, enabled: hasToken, staleTime: Infinity })
  if (!hasToken) return <Navigate to="/signin" replace state={{ from: location }} />
  if (profile.isLoading) return <Splash />
  // Only an invalid token clears it (fetchProfile). Any other failure (server down, offline launch)
  // used to bounce Splash ↔ /signin forever; show the error and let the user retry instead.
  if (profile.isError) {
    return (
      <ErrorScreen
        title="Can’t reach Baby Buddy"
        message={describeApiError(profile.error)}
        onRetry={() => void profile.refetch()}
        onSignOut={() => {
          tokenStore.clear()
          window.location.assign('/signin')
        }}
      />
    )
  }
  if (!profile.data) return <Navigate to="/signin" replace />
  setCurrentCaregiver(profile.data.user.username)
  return (
    <ChildProvider>
      <RequireChild />
    </ChildProvider>
  )
}

function RequireChild() {
  const { children, isLoading, isError, error, refetch } = useChildren()
  const location = useLocation()
  const profile = useQuery({ queryKey: qk.profile, queryFn: fetchProfile, staleTime: Infinity })
  // A grandparent's phone shows the simple screen instead of the app (Settings › People decides who).
  const screen = useMyScreen(profile.data?.user.username ?? '')
  if (isLoading || screen === 'loading') return <Splash />
  // A failed fetch is not "no children": sending an existing family to onboarding creates duplicates.
  if (isError && children.length === 0) return <ErrorScreen title="Couldn’t load your children" message={describeApiError(error)} onRetry={() => void refetch()} />
  if (children.length === 0 && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />
  if (screen.screen === 'simple' && children.length > 0) {
    return (
      <>
        <StorageUnitsSeeder />
        <SimplePage actions={screen.actions} username={profile.data?.user.username ?? ''} />
      </>
    )
  }
  return (
    <>
      <StorageUnitsSeeder />
      <PumpsSeeder />
      <MilkWindowsSync />
      <TimeZoneSync />
      <WhatsNewOnLaunch />
      <Outlet />
    </>
  )
}

function Shell() {
  useScrollToTop()
  return (
    <div className="app-shell">
      <Outlet />
      <TabBar />
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <div className="toast-stack">
          <UpdateBanner />
          <PrintNotice />
        </div>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/timer/:id" element={<TimerPage />} />
              <Route path="/contractions" element={<ContractionsPage />} />
              <Route element={<Shell />}>
                <Route index element={<HomePage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/report" element={<DoctorReportPage />} />
                <Route path="/nap" element={<NapPage />} />
                {/* The page's address until 1.47: old bookmarks and Home Screen history land on the new one. */}
                <Route path="/sweetspot" element={<Navigate to="/nap" replace />} />
                <Route path="/child" element={<ChildPage />} />
                <Route path="/plans" element={<SleepPlansPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/settings" element={<MorePage />} />
                <Route path="/milk" element={<MilkPage />} />
                <Route path="/more" element={<Navigate to="/settings" replace />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </PrefsProvider>
    </QueryClientProvider>
  )
}
