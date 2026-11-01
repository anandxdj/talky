import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ConsoleLayout } from '@/components/layout/ConsoleLayout'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TalkyConsoleProvider } from '@/context/TalkyConsoleContext'
import { ActionsPage } from '@/pages/ActionsPage'
import { AllowlistsPage } from '@/pages/AllowlistsPage'
import { ChatsPage } from '@/pages/ChatsPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { QueuePage } from '@/pages/QueuePage'
import { VoicePage } from '@/pages/VoicePage'

/** Keep pre-redesign URLs (and their query strings) working. */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

function App() {
  return (
    <TooltipProvider>
      <TalkyConsoleProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ConsoleLayout />}>
              <Route index element={<Navigate to="/overview" replace />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="conversations" element={<ChatsPage />} />
              <Route path="voice" element={<VoicePage />} />
              <Route path="access" element={<AllowlistsPage />} />
              <Route path="settings" element={<ActionsPage />} />
              <Route path="dashboard" element={<Redirect to="/overview" />} />
              <Route path="inbox" element={<Redirect to="/queue" />} />
              <Route path="chats" element={<Redirect to="/conversations" />} />
              <Route path="persona" element={<Redirect to="/voice" />} />
              <Route path="allowlists" element={<Redirect to="/access" />} />
              <Route path="actions" element={<Redirect to="/settings" />} />
            </Route>
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </TalkyConsoleProvider>
    </TooltipProvider>
  )
}

export default App
