'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

/**
 * Root page — redirects to /login or /dashboard based on auth state.
 */
export default function RootPage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [isAuthenticated, loading, router]);

  return (
    <div className="flex items-center justify-center h-screen bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-gov-blue-800 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-600 text-xs font-semibold">काठमाडौँ महानगरपालिका भू-सूचना प्रणाली लोड हुँदैछ...</p>
      </div>
    </div>
  );
}
