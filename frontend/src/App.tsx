import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useMe } from './api/hooks'
import { AppShell } from './components/layout/AppShell'
import { PageLoader } from './components/ui/Spinner'
import LoginPage from './pages/LoginPage'

const ContactsPage = lazy(() => import('./pages/contacts/ContactsPage'))
const ContactDetailPage = lazy(() => import('./pages/contacts/ContactDetailPage'))
const RemindersPage = lazy(() => import('./pages/reminders/RemindersPage'))
const AutomationsPage = lazy(() => import('./pages/automations/AutomationsPage'))
const ContentPage = lazy(() => import('./pages/content/ContentPage'))
const WhatsAppPage = lazy(() => import('./pages/whatsapp/WhatsAppPage'))
const ChatsPage = lazy(() => import('./pages/chats/ChatsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isPending } = useMe()
  const location = useLocation()
  if (isPending) return <PageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/contacts" replace />} />
        <Route path="contacts" element={<Lazy><ContactsPage /></Lazy>} />
        <Route path="contacts/:id" element={<Lazy><ContactDetailPage /></Lazy>} />
        <Route path="reminders" element={<Lazy><RemindersPage /></Lazy>} />
        <Route path="automations" element={<Lazy><AutomationsPage /></Lazy>} />
        <Route path="content" element={<Lazy><ContentPage /></Lazy>} />
        <Route path="whatsapp" element={<Lazy><WhatsAppPage /></Lazy>} />
        <Route path="chats" element={<Lazy><ChatsPage /></Lazy>} />
        <Route path="chats/:chatId" element={<Lazy><ChatsPage /></Lazy>} />
        <Route path="*" element={<Lazy><NotFoundPage /></Lazy>} />
      </Route>
    </Routes>
  )
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}
