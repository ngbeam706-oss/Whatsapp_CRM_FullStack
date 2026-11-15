import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './index.css'
import ErrorBoundary from './ErrorBoundary'
import { queryClient } from './queryClient'
import { supabase } from './supabaseClient'
import { isPublicPath } from './site/siteNav'
import { AREAS, LEGACY_BASE } from './appRoutes'
import { readLargeText, applyLargeText, AppFrameSkeleton, SiteSkeleton } from './ui'
import { ConfirmProvider } from './confirm'

// Signing out (or in as someone else) must never show the previous login's cached data.
// Supabase also sends SIGNED_IN when a tab is refocused, so clear only when the user changes.
let cachedUserId: string | null = null
supabase.auth.onAuthStateChange((event, session) => {
  const userId = session?.user?.id || null
  if (event === 'SIGNED_OUT' || userId !== cachedUserId) queryClient.clear()
  cachedUserId = userId
})

// "Larger text" chosen earlier in this browser (profile menu): applied before the first paint.
if (readLargeText()) applyLargeText(true)

// Only visitors load the public site; only signed-in addresses load the dashboard (each downloads when opened,
// with a skeleton meanwhile, so neither slows the other's first paint).
const PublicSite = lazy(() => import('./site/PublicSite'))
const Dashboard = lazy(() => import('./Dashboard'))

// Invite and password-reset emails land on the site's main address with the login details in the link:
// those go to the dashboard (with the details), so the links keep working.
const { pathname, hash, search } = window.location
const authLink = /(^|[#&])(access_token|type|error_description)=/.test(hash.slice(1)) || /[?&]code=/.test(search)
if (authLink && isPublicPath(pathname)) window.history.replaceState(null, '', `${LEGACY_BASE}${search}${hash}`)

// Someone signed in who opens the main address goes straight to their dashboard.
if (!authLink && pathname.replace(/\/+$/, '') === '') {
  supabase.auth.getSession().then(({ data }) => { if (data.session) window.location.replace(LEGACY_BASE) }).catch(() => {})
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {/* Last line of defence: a crash outside any screen shows "Reload" instead of a blank page. */}
    <ErrorBoundary name="app" fullPage>
      <BrowserRouter>
        {/* In-app "Are you sure?" dialogs for every screen (src/confirm.tsx), instead of browser pop-ups. */}
        <ConfirmProvider>
        <Routes>
          {/* Signed-in areas, one per role (/platform, /admin, /manager, /agent) plus the old /app: see Dashboard. */}
          {[LEGACY_BASE.slice(1), ...AREAS].map(a => <Route key={a} path={`/${a}/*`} element={<Suspense fallback={<AppFrameSkeleton />}><Dashboard /></Suspense>} />)}
          {/* The public website: /, /pricing, /privacy, ... (and its "page not found"). */}
          <Route path="*" element={<Suspense fallback={<SiteSkeleton />}><PublicSite /></Suspense>} />
        </Routes>
        </ConfirmProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
