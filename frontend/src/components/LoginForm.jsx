'use client';

import { useState } from 'react';
import { Shield, Eye, EyeOff, Loader2, Lock, User, Phone, CheckCircle, AlertCircle } from 'lucide-react';
import { EmblemOfNepal, NepalFlag, MunicipalLogo } from './NepalEmblem';

/**
 * LoginForm Component — Official Nepal Government Web Layout
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका) Single Sign-On Portal
 */
export default function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('कृपया प्रयोगकर्ताको नाम र पासवर्ड दुवै प्रविष्ट गर्नुहोस् (Please enter both username and password)');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      const msg = err.response?.data?.detail || 'लगइन असफल भयो । कृपया आफ्नो विवरण जाँच गर्नुहोस् (Login failed. Please check credentials).';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-y-auto flex flex-col bg-slate-100 font-sans overscroll-contain pb-safe">
      {/* 1. TOP TRICOLOR BAR */}
      <div className="gov-tricolor-bar shrink-0" />

      {/* 2. TOP METADATA BAR */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-1.5 sm:py-2 shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-gov-red-700 inline-block shrink-0" />
            <span className="font-semibold text-slate-800 truncate text-[11px] sm:text-xs">काठमाडौँ महानगरपालिका | भू-सूचना प्रणाली</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <NepalFlag className="w-4 h-5 sm:w-5 sm:h-6 shrink-0" />
          </div>
        </div>
      </div>

      {/* 3. MAIN LOGIN CARD CONTAINER */}
      <div className="flex-1 flex items-center justify-center p-3 sm:p-6 my-auto min-h-0">
        <div className="w-full max-w-lg animate-fade-in my-auto py-2">
          
          {/* Government Branding Header */}
          <div className="text-center mb-4 sm:mb-6">
            <div className="inline-flex items-center justify-center gap-3 mb-2 sm:mb-3">
              <EmblemOfNepal className="w-14 h-14 sm:w-16 sm:h-16 drop-shadow-md" size={64} />
              <MunicipalLogo className="w-14 h-14 sm:w-16 sm:h-16 drop-shadow-md" size={64} />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gov-blue-800 tracking-tight font-nepali mt-0.5">
              काठमाडौँ महानगरपालिका
            </h1>
            <p className="text-[11px] sm:text-xs font-medium text-slate-700 font-nepali">
              नगर कार्यपालिकाको कार्यालय, बागदरबार, काठमाडौँ
            </p>
            <div className="inline-block mt-1 sm:mt-1.5 px-2.5 py-0.5 bg-gov-blue-50 border border-gov-blue-200 rounded text-[11px] sm:text-xs font-bold text-gov-blue-900">
              भू-स्थानिक सूचना तथा नक्साङ्कन प्रणाली (KMC WebGIS)
            </div>
          </div>

          {/* Official Login Box */}
          <div className="bg-white border border-slate-300 rounded-xl shadow-lg overflow-hidden">
            {/* Box Header Banner */}
            <div className="bg-gov-blue-800 px-6 py-3.5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-gov-gold-400" />
                <h2 className="text-sm font-bold tracking-wide font-nepali">
                  सुरक्षित पहुँच प्रणाली (Authorized Sign In)
                </h2>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <form onSubmit={handleSubmit} className="space-y-4" id="login-form">
                
                {/* Error Alert */}
                {error && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-gov-red-50 border border-gov-red-200 animate-fade-in text-gov-red-800 text-xs">
                    <AlertCircle className="w-4 h-4 text-gov-red-700 flex-shrink-0 mt-0.5" />
                    <div>{error}</div>
                  </div>
                )}

                {/* Username */}
                <div>
                  <label htmlFor="username" className="gov-label flex items-center justify-between">
                    <span>प्रयोगकर्ताको नाम (Username)</span>
                    <span className="text-gov-red-700 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="gov-input pl-9"
                      placeholder="Username / अधिकृत नाम"
                      autoComplete="username"
                      autoFocus
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="password" className="gov-label flex items-center justify-between">
                    <span>गोप्य पासवर्ड (Password)</span>
                    <span className="text-gov-red-700 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="gov-input pl-9 pr-10"
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  id="login-submit"
                  type="submit"
                  disabled={loading}
                  className="btn-gov-primary w-full py-2.5 text-sm font-bold tracking-wide mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      प्रमाणीकरण हुँदैछ (Authenticating)...
                    </>
                  ) : (
                    'प्रणालीमा प्रवेश गर्नुहोस् (Sign In)'
                  )}
                </button>
              </form>

              {/* Notice */}
              <div className="mt-6 pt-4 border-t border-slate-200 text-center">
                <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                  <CheckCircle className="w-3.5 h-3.5 text-gov-blue-800" />
                  <span>काठमाडौँ महानगरपालिकाका अधिकृत तथा कर्मचारीहरूको लागि मात्र</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Unauthorized access is prohibited under Nepal IT Act.
                </div>
              </div>
            </div>
          </div>


        </div>
      </div>
    </div>
  );
}
