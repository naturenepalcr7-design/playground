'use client';

import { useAuth } from '../../lib/auth';
import LoginForm from '../../components/LoginForm';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated && !loading) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-gov-blue-800 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600 text-xs font-semibold">काठमाडौँ महानगरपालिका भू-सूचना प्रणाली लोड हुँदैछ...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) return null;

  const handleLogin = async (username, password) => {
    await login(username, password);
    router.replace('/dashboard');
  };

  return <LoginForm onLogin={handleLogin} />;
}
