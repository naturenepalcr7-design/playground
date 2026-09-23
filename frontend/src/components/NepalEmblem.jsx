'use client';

/**
 * Official Coat of Arms of Nepal (निशान छाप), Municipal Logo & Flag of Nepal Components
 * Uses locally stored official assets.
 */

export function EmblemOfNepal({ className = "w-14 h-14", size = 56 }) {
  return (
    <div className={`relative flex items-center justify-center flex-shrink-0 ${className}`}>
      <img
        src="/assets/Nepal.png"
        alt="Coat of Arms of Nepal"
        width={size}
        height={size}
        className="w-full h-full object-contain drop-shadow-sm"
        loading="eager"
      />
    </div>
  );
}

export function MunicipalLogo({ className = "w-14 h-14", size = 56 }) {
  return (
    <div className={`relative flex items-center justify-center flex-shrink-0 ${className}`}>
      <img
        src="/assets/KMC.png"
        alt="Kathmandu Metropolitan City Logo"
        width={size}
        height={size}
        className="w-full h-full object-contain drop-shadow-sm"
        loading="eager"
      />
    </div>
  );
}

export function NepalFlag({ className = "w-7 h-9" }) {
  return (
    <div className={`relative flex items-center justify-center flex-shrink-0 ${className}`}>
      <img
        src="/assets/Nepal_flag.webp"
        alt="Flag of Nepal"
        className="w-full h-full object-contain drop-shadow-sm nepal-flag-wave"
        loading="eager"
      />
    </div>
  );
}
