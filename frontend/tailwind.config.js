/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Nepal Government Brand Colors (NDRRMA / MOFA / GIWMS Standard)
        'gov-blue': {
          50: '#eef5ff',
          100: '#d9e8ff',
          200: '#bcd7ff',
          300: '#8ebeff',
          400: '#599bff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#0447af', // Nepal Gov Royal Navy Blue Primary
          900: '#033585',
          950: '#02204e', // Deep Gov Blue
        },
        'gov-red': {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#c8102e', // Nepal Flag Crimson Red
          800: '#9f0c24',
          900: '#881337',
        },
        'gov-gold': {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        // Clean government surfaces
        'gov-surface': {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Backward compatibility
        kmc: {
          50: '#eef5ff',
          100: '#d9e8ff',
          200: '#bcd7ff',
          300: '#8ebeff',
          400: '#599bff',
          500: '#0447af',
          600: '#033585',
          700: '#02204e',
          800: '#011638',
          900: '#000f26',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        status: {
          ready: '#0447af',
          locked: '#f59e0b',
          mapped: '#10b981',
          validating: '#8b5cf6',
          validated: '#06b6d4',
          invalidated: '#c8102e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', '-apple-system', 'sans-serif'],
        nepali: ['Noto Sans Devanagari', 'Mukta', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'gov': '0 2px 8px rgba(4, 71, 175, 0.08)',
        'gov-lg': '0 10px 25px -3px rgba(4, 71, 175, 0.12), 0 4px 6px -4px rgba(4, 71, 175, 0.07)',
        'gov-card': '0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.04)',
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fade-in 0.25s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
        'slide-right': 'slide-right 0.25s ease-out',
        'ticker': 'ticker 35s linear infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%': { opacity: '0.1', transform: 'scale(1.5)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'ticker': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
      },
    },
  },
  plugins: [],
};
