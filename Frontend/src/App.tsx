import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import DashboardPage from './pages/DashboardPage'
import SessionSetupPage from './pages/SessionSetupPage'
import LiveConversationPage from './pages/LiveConversationPage'
import SessionSummaryPage from './pages/SessionSummaryPage'
import HistoryPage from './pages/HistoryPage'
import FAQPage from './pages/FAQPage'
import SettingsPage from './pages/SettingsPage'
import DatasetCollectorPage from './pages/DatasetCollectorPage'

function LegacySummaryRedirect() {
  const { sessionId } = useParams()
  return <Navigate to={`/summary/${encodeURIComponent(sessionId ?? '')}`} replace />
}

export default function App() {
  const collectorPage = useLocation().pathname === '/dataset-collector'
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const mobileNavigation = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => { setNarrow(media.matches); setMobileNavigationOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => setMobileNavigationOpen(false), [collectorPage])
  useEffect(() => {
    if (!collectorPage || !narrow || !mobileNavigationOpen) return
    const previous = document.activeElement as HTMLElement | null
    const controls = mobileNavigation.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    controls?.[0]?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileNavigationOpen(false) }
      if (event.key !== 'Tab' || !controls?.length) return
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [collectorPage, narrow, mobileNavigationOpen])
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem('daloy:sidebar-collapsed') === 'true'
  )

  function toggleSidebar() {
    if (collectorPage && narrow) { setMobileNavigationOpen(previous => !previous); return }
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('daloy:sidebar-collapsed', String(next))
      return next
    })
  }

  return (
    <div className={`grid ${collectorPage && narrow || isCollapsed ? 'grid-cols-[60px_minmax(0,1fr)]' : 'grid-cols-[256px_minmax(0,1fr)]'} min-h-screen ${collectorPage ? 'min-h-[100dvh]' : 'h-screen transition-all duration-300'}`}>
      {collectorPage && narrow && mobileNavigationOpen && <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-ink/30" onClick={() => setMobileNavigationOpen(false)} />}
      <div ref={mobileNavigation} role={collectorPage && narrow && mobileNavigationOpen ? 'dialog' : undefined}
        aria-modal={collectorPage && narrow && mobileNavigationOpen || undefined} aria-label={collectorPage && narrow && mobileNavigationOpen ? 'Navigation' : undefined}
        className={collectorPage && narrow && mobileNavigationOpen ? 'fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto bg-trust [&>aside]:min-h-full' : collectorPage ? 'contents [&>aside]:sticky [&>aside]:top-0 [&>aside]:h-[100dvh] [&>aside]:overflow-y-auto' : 'contents'}>
        <Sidebar isCollapsed={collectorPage && narrow ? !mobileNavigationOpen : isCollapsed} onToggle={toggleSidebar} />
      </div>
      <main data-collector-page={collectorPage || undefined} className={collectorPage ? 'col-start-2 min-w-0 px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8 overflow-x-hidden' : 'px-8 py-8 overflow-x-hidden'}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/setup" element={<SessionSetupPage />} />
          <Route path="/session-setup" element={<Navigate to="/setup" replace />} />
          <Route path="/session-summary/:sessionId" element={<LegacySummaryRedirect />} />
          <Route path="/live" element={<LiveConversationPage />} />
          <Route path="/summary/:sessionId" element={<SessionSummaryPage />} />
          <Route path="/dataset-collector" element={<DatasetCollectorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
