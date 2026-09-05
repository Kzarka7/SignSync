import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import DashboardPage from './pages/DashboardPage'
import SessionSetupPage from './pages/SessionSetupPage'
import LiveConversationPage from './pages/LiveConversationPage'
import SessionSummaryPage from './pages/SessionSummaryPage'
import HistoryPage from './pages/HistoryPage'
import ResourcesPage from './pages/ResourcesPage'
import SettingsPage from './pages/SettingsPage'
import DatasetCollectorPage from './pages/DatasetCollectorPage'

export default function App() {
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem('daloy:sidebar-collapsed') === 'true'
  )

  function toggleSidebar() {
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('daloy:sidebar-collapsed', String(next))
      return next
    })
  }

  return (
    <div className={`grid ${isCollapsed ? 'grid-cols-[60px_1fr]' : 'grid-cols-[280px_1fr]'} min-h-screen transition-all duration-300`}>
      <Sidebar isCollapsed={isCollapsed} onToggle={toggleSidebar} />
      <main className="px-8 py-8 overflow-x-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/session-setup" element={<SessionSetupPage />} />
          <Route path="/live" element={<LiveConversationPage />} />
          <Route path="/session-summary/:sessionId" element={<SessionSummaryPage />} />
          <Route path="/dataset-collector" element={<DatasetCollectorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}