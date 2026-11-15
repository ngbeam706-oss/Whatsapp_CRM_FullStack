import { lazy, Suspense, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ShieldOff } from 'lucide-react';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import AuthGate, { SignOutButton } from './AuthGate';
import { takeJustSignedIn } from './signInFlag';
import { queryClient } from './queryClient';
import { AppFrameSkeleton } from './ui';
import { AREA_LABEL, AREA_OF_ROLE, LEGACY_BASE, areaOf, type Area } from './appRoutes';
import type { Role } from './types';

// Only platform admins ever load the console.
const PlatformConsole = lazy(() => import('./PlatformConsole'));
// Only clinic doctors ever load the doctor area (their own appointments and hours; never chats).
const DoctorApp = lazy(() => import('./DoctorApp'));

/**
 * Every signed-in address (/platform, /admin, /manager, /agent, and the old /app) comes here.
 *   1. AuthGate: signed out -> the sign-in page (the address is kept, so you land on it after signing in).
 *   2. AreaGate: the address must be your role's own area; another role's address shows "Not allowed".
 *   3. Inside a business area, App guards the managers' screens again.
 * The server checks every request on its own, so none of this is the only protection.
 */
export default function Dashboard() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        {({ session, staff, platformAdmin, doctor, signOut }) => (
          <AreaGate
            email={session.user.email || ''}
            // AuthGate only gets here with a staff row or a platform admin; 'agent' is the least-privileged fallback.
            area={platformAdmin ? 'platform' : doctor ? 'doctor' : AREA_OF_ROLE[staff?.role ?? 'agent']}
            role={staff?.role ?? 'agent'}
            signOut={signOut}
          />
        )}
      </AuthGate>
    </QueryClientProvider>
  );
}

function AreaGate({ email, area, role, signOut }: { email: string; area: Area; role: Role; signOut: () => void }) {
  const { pathname, search } = useLocation();
  // Read once per sign-in (AuthGate marks it when the sign-in form succeeds).
  const [justSignedIn] = useState(takeJustSignedIn);
  const asked = areaOf(pathname);
  const home = `/${area}`;
  // Old links (/app/ads) and the bare sign-in address move to your own area, same page.
  if (asked === 'legacy') return <Navigate to={`${home}${pathname.slice(LEGACY_BASE.length)}${search}`} replace />;
  // Just signed in on a page left at another role's address (e.g. the agent who signed out before): go to your
  // own area, the same screen when your role has it (business areas share their screen addresses).
  if (asked !== area && justSignedIn) {
    const business = (a: Area | null) => a === 'admin' || a === 'manager' || a === 'agent';
    const rest = asked && business(asked) && business(area) ? pathname.slice(asked.length + 1) : '';
    return <Navigate to={`${home}${rest}`} replace />;
  }
  if (asked !== area) return <NotAllowed asked={asked} home={home} email={email} signOut={signOut} />;
  if (area === 'platform') {
    return <Suspense fallback={<AppFrameSkeleton label="Loading the platform console" />}><PlatformConsole base={home} email={email} onSignOut={signOut} /></Suspense>;
  }
  if (area === 'doctor') {
    return <Suspense fallback={<AppFrameSkeleton label="Loading your appointments" />}><DoctorApp base={home} email={email} onSignOut={signOut} /></Suspense>;
  }
  return <App base={home} userEmail={email} userRole={role} onSignOut={signOut} />;
}

function NotAllowed({ asked, home, email, signOut }: { asked: Area | null; home: string; email: string; signOut: () => void }) {
  return (
    <div className="min-h-screen bg-slate-200 flex items-center justify-center px-4" data-testid="area-not-allowed">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 space-y-3 text-center">
        <ShieldOff className="w-9 h-9 text-slate-400 mx-auto" />
        <h1 className="text-lg font-bold text-slate-800">Not allowed for your role</h1>
        <p className="text-sm text-slate-600">
          {asked ? <>This address is for {AREA_LABEL[asked]}. </> : null}
          You&apos;re signed in as <span className="font-medium">{email}</span>, which can&apos;t open it.
        </p>
        <a href={home} className="block w-full bg-wa-teal text-white rounded-lg py-2 text-sm font-semibold">Go to my dashboard</a>
        <div className="flex justify-center"><SignOutButton email={email} onSignOut={signOut} /></div>
      </div>
    </div>
  );
}
