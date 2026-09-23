'use client';

import { useState } from 'react';
import {
  MapPin, AlertTriangle, ShieldAlert, RefreshCw,
  CheckCircle2, Compass, Smartphone, Globe, Lock, Info,
} from 'lucide-react';

/**
 * GpsGuardModal — Compulsory GPS Requirement Guard for Data Collectors
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * 
 * Ensures data collectors cannot proceed with survey operations unless
 * device GPS/Location services are enabled and permission is granted.
 */
export default function GpsGuardModal({
  isCollector = false,
  gpsPosition = null,
  gpsError = null,
  isTracking = false,
  onRetry = null,
}) {
  const [retrying, setRetrying] = useState(false);

  // Only apply compulsory lock if user is a Data Collector and GPS is missing or errored
  if (!isCollector || (gpsPosition && gpsPosition.lat && gpsPosition.lng && !gpsError)) {
    return null;
  }

  const handleRetryClick = async () => {
    setRetrying(true);
    if (onRetry) {
      onRetry();
    }
    setTimeout(() => {
      setRetrying(false);
    }, 1200);
  };

  const isPermissionDenied = gpsError?.code === 1 || (gpsError?.message || '').toLowerCase().includes('denied');
  const isHttp = typeof window !== 'undefined' && window.location.protocol === 'http:';
  const isInsecureOrigin = isHttp || (gpsError?.message || '').toLowerCase().includes('secure origin') || (gpsError?.message || '').toLowerCase().includes('https');

  const handleSwitchToHttps = () => {
    if (typeof window !== 'undefined') {
      window.location.href = window.location.href.replace('http:', 'https:');
    }
  };

  return (
    <div className="fixed inset-0 z-99999 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none animate-fade-in font-sans">
      <div className="bg-white rounded-2xl shadow-2xl border-2 border-gov-red-500 w-full max-w-lg max-h-[92dvh] overflow-hidden flex flex-col animate-slide-up">
        
        {/* Government Top Banner */}
        <div className="bg-gradient-to-r from-gov-red-700 via-gov-red-600 to-gov-red-800 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-xs flex items-center justify-center ring-2 ring-white/30 shrink-0">
              <ShieldAlert className="w-6 h-6 text-gov-gold-400 animate-pulse" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-gov-gold-300 tracking-wider uppercase font-nepali">
                काठमाडौँ महानगरपालिका &middot; नगर कार्यपालिकाको कार्यालय
              </div>
              <h2 className="text-base font-black tracking-tight font-nepali">
                स्थान (GPS) अनुमति अनिवार्य छ
              </h2>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4 text-xs text-slate-700 flex-1 overflow-y-auto overscroll-contain">
          
          {/* Warning Callout */}
          <div className="bg-gov-red-50 border border-gov-red-200 rounded-xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-gov-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-gov-red-900 font-nepali text-[13px]">
                तथ्याङ्क संकलकका लागि GPS स्थान खोल्न अनिवार्य
              </div>
              <p className="text-[11px] text-gov-red-800 leading-relaxed font-nepali">
                काठमाडौँ महानगरपालिका भू-स्थानिक (WebGIS) प्रणालीमा फिल्ड सर्भे तथा तथ्याङ्क संकलनको आधिकारिकता,
                सत्यता र जियोफेन्सिङ सुनिश्चित गर्न तपाईँको यन्त्रको <strong>लाइभ GPS स्थान</strong> सक्रिय हुनु अनिवार्य छ।
              </p>
            </div>
          </div>

          {/* Current Status Message */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-800">
              <span className="flex items-center gap-1.5 font-nepali">
                <Compass className="w-4 h-4 text-gov-blue-800" />
                <span>हालको GPS स्थिति (Status):</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                isPermissionDenied
                  ? 'bg-red-100 text-red-800'
                  : 'bg-amber-100 text-amber-900'
              }`}>
                {isPermissionDenied ? 'अनुमति रोकियो (Permission Denied)' : 'स्थान खोजी हुँदै (Acquiring Location...)'}
              </span>
            </div>

            {gpsError ? (
              <div className="text-[11px] text-red-700 bg-white p-2 rounded border border-red-100 font-mono">
                {gpsError.message || 'GPS location not available. Please allow location access.'}
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 italic font-nepali">
                यन्त्रको GPS संकेत पर्खिंदैछ... कृपया ब्राउजरमा पप-अप आएमा "Allow" मा क्लिक गर्नुहोस्।
              </div>
            )}

            {/* Insecure Origin Notice & Direct HTTPS Switch Button */}
            {isInsecureOrigin && (
              <div className="mt-2 bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-amber-900 text-[11px] space-y-1.5">
                <div className="font-bold flex items-center gap-1 font-nepali">
                  <Lock className="w-3.5 h-3.5 text-amber-700" />
                  <span>सुरक्षित HTTPS जडान आवश्यक (HTTPS Required)</span>
                </div>
                <p className="font-nepali leading-relaxed text-[10.5px]">
                  ब्राउजर सुरक्षा नियमअनुसार GPS स्थान केवल सुरक्षित (HTTPS) ठेगानामा मात्र सक्रिय हुन्छ।
                </p>
                <button
                  type="button"
                  onClick={handleSwitchToHttps}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-3 rounded text-[11px] flex items-center justify-center gap-1.5 transition-colors font-nepali shadow-xs"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>सुरक्षित HTTPS मा जानुहोस् (Switch to Secure HTTPS)</span>
                </button>
              </div>
            )}
          </div>

          {/* Step-by-Step Instructions */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-800 font-nepali flex items-center gap-1.5">
              <Info className="w-4 h-4 text-gov-blue-800" />
              <span>स्थान अनुमति कसरी खोल्ने? (How to Enable):</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-slate-600">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
                <div className="font-bold text-slate-800 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-gov-blue-700" />
                  <span>Chrome / Edge ब्राउजर:</span>
                </div>
                <ol className="list-decimal list-inside space-y-0.5 leading-tight font-nepali">
                  <li>URL ठेगानाको बायाँपट्टि रहेको <strong>प्याडलक (ताल्चा 🔒)</strong> वा ट्युन आइकन थिच्नुहोस्।</li>
                  <li><strong>Location (स्थान)</strong> लाई <strong>Allow (स्वीकार)</strong> गर्नुहोस्।</li>
                  <li>SSL चेतावनी आएमा <em>Advanced &rarr; Proceed</em> थिच्नुहोस्।</li>
                </ol>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
                <div className="font-bold text-slate-800 flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
                  <span>मोबाइल (Android / iPhone):</span>
                </div>
                <ol className="list-decimal list-inside space-y-0.5 leading-tight font-nepali">
                  <li>मोबाइलको <strong>Location / GPS</strong> सक्रिय गर्नुहोस्।</li>
                  <li>ब्राउजर अनुमति सोध्दा <strong>"While using the app"</strong> छान्नुहोस्।</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleRetryClick}
              disabled={retrying}
              className="w-full bg-gradient-to-r from-gov-blue-800 to-gov-blue-900 hover:from-gov-blue-900 hover:to-gov-blue-950 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-98 font-nepali text-xs"
            >
              <RefreshCw className={`w-4 h-4 text-gov-gold-400 ${retrying ? 'animate-spin' : ''}`} />
              <span>{retrying ? 'स्थान जाँच गरिँदैछ...' : 'स्थान पुनः पत्ता लगाउनुहोस् (Retry GPS Detection)'}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-100 px-5 py-2.5 border-t border-slate-200 text-center text-[10px] text-slate-500 font-nepali">
          काठमाडौँ महानगरपालिका WebGIS सर्भे प्रणाली &middot; प्राविधिक सहयोगका लागि GIS शाखामा सम्पर्क गर्नुहोस्
        </div>
      </div>
    </div>
  );
}
