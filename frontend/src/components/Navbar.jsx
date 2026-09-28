'use client';

import { useState } from 'react';
import {
  MapPin, User, LogOut, ChevronDown, Settings,
  FolderOpen, Layers, Menu, X,
  Shield, Check, Globe, Home as HouseNumberingIcon
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { EmblemOfNepal, NepalFlag, MunicipalLogo } from './NepalEmblem';

/**
 * Navbar Component — Official Nepal Government Web Layout
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * Follows NDRRMA / MOFA / GIWMS Government standards.
 */
export default function Navbar({
  activeProject,
  onProjectSelect,
  projects = [],
  onOpenLayers,
  onOpenTasks,
  onOpenAdmin,
  isOnline = true,
}) {
  const { user, logout, isAdmin } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileProjectList, setShowMobileProjectList] = useState(false);

  const roleBadge = {
    GisAdmin: { label: 'GIS अधिकृत (Admin)', labelEn: 'GIS Administrator', class: 'bg-gov-blue-50 text-gov-blue-800 border-gov-blue-300' },
    DataCollector: { label: 'तथ्याङ्क संकलक (Collector)', labelEn: 'Field Data Collector', class: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
    Validator: { label: 'प्रमाणीकरणकर्ता (Validator)', labelEn: 'Data Validator', class: 'bg-purple-50 text-purple-800 border-purple-300' },
  };

  const currentRole = roleBadge[user?.role] || roleBadge.DataCollector;

  return (
    <header className="w-full bg-white shadow-md z-40 relative flex-shrink-0" id="government-header">
      {/* 1. TOP ACCENT TRICOLOR BAR */}
      <div className="gov-tricolor-bar" />

      {/* 2. OFFICIAL GOVERNMENT MASTHEAD (Ultra-compact on mobile, expansive on desktop) */}
      <div className="px-2.5 sm:px-4 py-1 md:py-2.5 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 md:gap-4">
          
          {/* Left: Coat of Arms + Municipal Hierarchy */}
          <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
            <EmblemOfNepal className="w-8 h-8 sm:w-10 sm:h-10 md:w-14 md:h-14 shrink-0" size={56} />
            <MunicipalLogo className="w-8 h-8 sm:w-10 sm:h-10 md:w-14 md:h-14 shrink-0 hidden sm:block" size={56} />
            
            <div className="leading-tight min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs sm:text-base md:text-xl font-bold text-gov-blue-800 tracking-tight font-nepali truncate">
                  काठमाडौँ महानगरपालिका
                </h1>
                <span className="md:hidden text-[9px] font-bold text-gov-blue-900 uppercase bg-gov-blue-50 px-1 py-0.2 rounded border border-gov-blue-100 shrink-0">
                  WebGIS
                </span>
              </div>
              <div className="hidden md:inline-block text-[10px] md:text-[11px] font-semibold text-gov-blue-900 uppercase tracking-wider bg-gov-blue-50/80 px-1.5 py-0.5 rounded mt-0.5 border border-gov-blue-100">
                भू-स्थानिक सूचना तथा नक्साङ्कन प्रणाली (KMC WebGIS)
              </div>
            </div>
          </div>

          {/* Right: National Flag & User Profile & Mobile Controls */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Waving National Flag (Desktop only) */}
            <div className="hidden lg:flex items-center gap-2 pr-3 border-r border-slate-200">
              <NepalFlag className="w-8 h-10" />
            </div>

            {/* Project Selector in Masthead (Tablet / Desktop only) */}
            <div className="relative hidden md:block">
              <button
                id="project-selector"
                onClick={() => setShowProjectMenu(!showProjectMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gov-blue-50/80 hover:bg-gov-blue-100/90
                           border border-gov-blue-200 text-xs font-medium text-gov-blue-950 transition-all shadow-sm"
              >
                <FolderOpen className="w-3.5 h-3.5 text-gov-blue-800" />
                <div className="text-left">
                  <div className="text-[9px] text-gov-blue-700 font-semibold uppercase tracking-wider">सक्रिय परियोजना (Project)</div>
                  <div className="max-w-[150px] truncate font-bold text-slate-900">
                    {activeProject ? activeProject.name : (isAdmin ? 'समग्र महानगर (Global)' : 'परियोजना छान्नुहोस्')}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-gov-blue-800 ml-1" />
              </button>

              {showProjectMenu && (
                <div className="absolute top-full right-0 mt-1 w-72 max-w-[calc(100vw-24px)] bg-white rounded-lg border border-slate-200 shadow-xl p-1.5 z-50 animate-fade-in"
                     id="project-dropdown">
                  <div className="px-2.5 py-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 mb-1 flex items-center justify-between">
                    <span>नगरस्तरीय परियोजनाहरू</span>
                    {isAdmin && <span className="text-[9px] text-gov-blue-800 font-semibold uppercase">Admin Mode</span>}
                  </div>

                  {/* Global Option for GIS Admin */}
                  {isAdmin && (
                    <button
                      onClick={() => { onProjectSelect(null); setShowProjectMenu(false); }}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors mb-1.5 border ${
                        !activeProject
                          ? 'bg-gov-blue-50 text-gov-blue-900 font-bold border-gov-blue-800 ring-1 ring-gov-blue-800'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold font-nepali">
                          <Globe className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
                          <span>समग्र महानगर (Global View)</span>
                        </div>
                        {!activeProject && (
                          <Check className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 pl-5">
                        सबै सार्वजनिक भेक्टर र ड्रोन इमेज्री तहहरू
                      </div>
                    </button>
                  )}

                  {projects.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">कुनै परियोजना उपलब्ध छैन</p>
                  ) : (
                    projects.map((proj) => (
                      <button
                        key={proj.id}
                        onClick={() => { onProjectSelect(proj); setShowProjectMenu(false); }}
                        className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors
                          ${activeProject?.id === proj.id
                            ? 'bg-gov-blue-50 text-gov-blue-800 font-semibold border-l-2 border-gov-blue-800'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                      >
                        <div className="font-semibold truncate">{proj.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 flex items-center justify-between">
                          <span>{proj.task_count || 0} ग्रिड कार्यहरू</span>
                          <span className="uppercase text-[9px] px-1 bg-slate-200 rounded">{proj.status}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* User Profile Pill (Tablet / Desktop only) */}
            <div className="relative hidden md:block">
              <button
                id="user-menu-trigger"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gov-blue-800 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                  <User className="w-4 h-4" />
                </div>
                <div className="hidden md:block text-left pr-1">
                  <div className="text-xs font-bold text-slate-800 leading-tight">
                    {user?.full_name || user?.username}
                  </div>
                  <div className="text-[10px] text-gov-blue-700 font-semibold">
                    {currentRole.label}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 hidden md:block" />
              </button>

              {showUserMenu && (
                <div className="absolute top-full right-0 mt-1 w-56 max-w-[calc(100vw-24px)] bg-white rounded-lg border border-slate-200 shadow-xl p-1 z-50 animate-fade-in"
                     id="user-dropdown">
                  <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 rounded-t-lg">
                    <div className="text-xs font-bold text-slate-800">{user?.full_name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{user?.email}</div>
                    <div className="mt-1">
                      <span className={`inline-block px-1.5 py-0.2 text-[9px] font-bold rounded border ${currentRole.class}`}>
                        {currentRole.label}
                      </span>
                    </div>
                  </div>

                  <button
                    id="logout-btn"
                    onClick={() => { logout(); window.location.href = '/login'; }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gov-red-700
                               hover:bg-gov-red-50 rounded-md transition-colors mt-1 font-semibold"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    प्रणालीबाट बाहिरिनुहोस् (Sign Out)
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Quick Status & Project Chip (< md) */}
            <div className="flex md:hidden items-center gap-1.5">
              {/* Online indicator dot on mobile */}
              <div
                className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 ring-2 ring-emerald-100 animate-pulse' : 'bg-amber-500 ring-2 ring-amber-100'}`}
                title={isOnline ? 'प्रत्यक्ष अनलाइन (Online)' : 'अफलाइन मोड (Offline)'}
              />

              {/* Active Project badge on mobile */}
              {activeProject && (
                <button
                  onClick={() => setShowMobileMenu(true)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded bg-gov-blue-50 border border-gov-blue-200 text-[10px] font-semibold text-gov-blue-950 max-w-[110px] truncate"
                  title="सक्रिय परियोजना परिवर्तन गर्नुहोस्"
                >
                  <FolderOpen className="w-3 h-3 text-gov-blue-800 shrink-0" />
                  <span className="truncate">{activeProject.name}</span>
                </button>
              )}

              {/* Mobile Drawer Trigger Button */}
              <button
                id="mobile-menu-toggle"
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors flex items-center justify-center ml-0.5"
                title="मेनु खोल्नुहोस् (Menu)"
                aria-label="मेनु खोल्नुहोस्"
              >
                {showMobileMenu ? (
                  <X className="w-4.5 h-4.5 text-slate-800" />
                ) : (
                  <Menu className="w-4.5 h-4.5 text-slate-800" />
                )}
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* 3. GOVERNMENT NAVIGATION RIBBON (Royal Navy Blue #0447AF) — Visible on Desktop (md+), Hidden on Mobile to maximize map canvas */}
      <nav className="bg-gov-blue-800 text-white px-4 shadow-inner hidden md:block" id="main-gov-navigation">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center overflow-x-auto py-1 scrollbar-none gap-1">
            <button
              className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-gov-blue-950 text-white flex items-center gap-1.5 transition-colors border border-gov-blue-700/50"
            >
              <MapPin className="w-3.5 h-3.5 text-gov-gold-400" />
              <span>नक्सा कार्यस्थल (WebGIS Portal)</span>
            </button>

            <button onClick={() => { window.location.href = '/house-numbering'; }} className="px-3.5 py-1.5 rounded-md text-xs font-medium text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white flex items-center gap-1.5 transition-colors"><HouseNumberingIcon className="w-3.5 h-3.5" /><span>घर नम्बरिङ (House Numbering)</span></button>

            <button onClick={() => { setShowMobileMenu(false); window.location.href = '/house-numbering'; }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-transparent"><HouseNumberingIcon className="w-4 h-4" /><span>घर नम्बरिङ (House Numbering)</span></button>

                {onOpenLayers && (
              <button
                onClick={onOpenLayers}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>तह व्यवस्थापन (GIS Layers)</span>
              </button>
            )}

            {onOpenTasks && (
              <button
                onClick={onOpenTasks}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>कार्य विभाजन ग्रिड (Task Grid)</span>
              </button>
            )}

            {isAdmin && onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>प्रशासनिक प्यानल (Admin Control)</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold border transition-colors ${
              isOnline
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50'
                : 'bg-amber-950/70 text-amber-300 border-amber-500/50'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span>{isOnline ? 'प्रत्यक्ष अनलाइन (Online)' : 'अफलाइन मोड (Offline)'}</span>
            </div>

            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-gov-blue-200">
              <Shield className="w-3.5 h-3.5 text-gov-gold-400" />
              <span>काठमाडौँ महानगरपालिका</span>
            </div>
          </div>
        </div>
      </nav>

      {/* 4. MOBILE NAVIGATION SLIDE-OVER DRAWER (< md) */}
      {showMobileMenu && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 animate-fade-in md:hidden"
            onClick={() => setShowMobileMenu(false)}
          />

          {/* Drawer Container */}
          <div className="fixed top-0 right-0 h-full h-[100dvh] w-[300px] max-w-[85vw] bg-white border-l border-slate-300 shadow-2xl z-50 overflow-hidden flex flex-col animate-slide-right md:hidden pb-safe pt-safe">
            
            {/* Drawer Header: User Info & Close Button */}
            <div className="bg-gov-blue-800 text-white p-3.5 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-gov-blue-950 text-white flex items-center justify-center font-bold text-sm border border-gov-blue-400 shadow-sm shrink-0">
                  <User className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate leading-tight">
                    {user?.full_name || user?.username}
                  </div>
                  <div className="text-[10px] text-gov-blue-200 truncate mt-0.5">
                    {user?.email || 'kmc.gov.np'}
                  </div>
                  <span className={`inline-block mt-1 px-1.5 py-0.2 text-[8px] font-bold rounded border ${currentRole.class}`}>
                    {currentRole.label}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setShowMobileMenu(false)}
                className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-1 rounded transition-colors"
                title="बन्द गर्नुहोस्"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans">
              
              {/* Online / Offline Status Badge */}
              <div className={`flex items-center justify-between p-2 rounded-lg border text-xs font-semibold ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                  <span>{isOnline ? 'प्रत्यक्ष अनलाइन (Online)' : 'अफलाइन मोड (Offline)'}</span>
                </div>
                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/70 font-mono font-bold">
                  {isOnline ? 'Active' : 'Offline'}
                </span>
              </div>

              {/* Navigation Menu Options */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                  प्रणाली नेभिगेसन
                </div>

                <button
                  onClick={() => setShowMobileMenu(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gov-blue-50 text-gov-blue-900 border border-gov-blue-200 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-gov-blue-800" />
                  <span>नक्सा कार्यस्थल (WebGIS Portal)</span>
                </button>

                {onOpenLayers && (
                  <button
                    onClick={() => { setShowMobileMenu(false); onOpenLayers(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-transparent"
                  >
                    <Layers className="w-4 h-4 text-slate-500" />
                    <span>तह व्यवस्थापन (GIS Layers)</span>
                  </button>
                )}

                {onOpenTasks && activeProject && (
                  <button
                    onClick={() => { setShowMobileMenu(false); onOpenTasks(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-transparent"
                  >
                    <FolderOpen className="w-4 h-4 text-slate-500" />
                    <span>कार्य विभाजन ग्रिड (Task Grid)</span>
                  </button>
                )}

                {isAdmin && onOpenAdmin && (
                  <button
                    onClick={() => { setShowMobileMenu(false); onOpenAdmin(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors border border-transparent"
                  >
                    <Settings className="w-4 h-4 text-slate-500" />
                    <span>प्रशासनिक प्यानल (Admin Control)</span>
                  </button>
                )}
              </div>

              {/* Project Switching Section */}
              <div className="space-y-1 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    नगरस्तरीय परियोजनाहरू ({projects.length})
                  </span>
                  <button
                    onClick={() => setShowMobileProjectList(!showMobileProjectList)}
                    className="text-[10px] text-gov-blue-800 font-semibold flex items-center gap-0.5"
                  >
                    {showMobileProjectList ? 'लुकाउनुहोस्' : 'हेर्नुहोस्'}
                    <ChevronDown className={`w-3 h-3 transition-transform ${showMobileProjectList ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-medium">हालको सक्रिय परियोजना:</div>
                  <div className="text-xs font-bold text-slate-900 truncate mt-0.5">
                    {activeProject ? activeProject.name : (isAdmin ? 'समग्र महानगर (Global View)' : 'कुनै परियोजना छानिएको छैन')}
                  </div>
                </div>

                {showMobileProjectList && (
                  <div className="space-y-1 mt-1 max-h-48 overflow-y-auto scrollbar-thin">
                    {/* Global Option for GIS Admin */}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          onProjectSelect(null);
                          setShowMobileMenu(false);
                        }}
                        className={`w-full text-left p-2 rounded-md text-xs transition-colors border ${
                          !activeProject
                            ? 'bg-gov-blue-50 border-gov-blue-300 text-gov-blue-900 font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold font-nepali">
                            <Globe className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
                            <span>समग्र महानगर (Global View)</span>
                          </div>
                          {!activeProject && <Check className="w-3.5 h-3.5 text-gov-blue-800 shrink-0 ml-1" />}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 pl-5">
                          सबै सार्वजनिक भेक्टर र इमेज्री तहहरू
                        </div>
                      </button>
                    )}

                    {projects.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-slate-500 italic">कुनै परियोजना उपलब्ध छैन</p>
                    ) : (
                      projects.map((proj) => (
                        <button
                          key={proj.id}
                          onClick={() => {
                            onProjectSelect(proj);
                            setShowMobileMenu(false);
                          }}
                          className={`w-full text-left p-2 rounded-md text-xs transition-colors border ${
                            activeProject?.id === proj.id
                              ? 'bg-gov-blue-50 border-gov-blue-300 text-gov-blue-900 font-bold'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="truncate flex items-center justify-between">
                            <span className="truncate">{proj.name}</span>
                            {activeProject?.id === proj.id && <Check className="w-3.5 h-3.5 text-gov-blue-800 shrink-0 ml-1" />}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 flex items-center justify-between">
                            <span>{proj.task_count || 0} कार्यहरू</span>
                            <span className="uppercase text-[8px] px-1 bg-slate-100 rounded">{proj.status}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

            </div>

            {/* Drawer Footer: Sign Out */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
              <button
                onClick={() => { logout(); window.location.href = '/login'; }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gov-red-50 hover:bg-gov-red-100 text-gov-red-700 border border-gov-red-200 text-xs font-bold transition-colors shadow-xs"
              >
                <LogOut className="w-4 h-4" />
                <span>प्रणालीबाट बाहिरिनुहोस् (Sign Out)</span>
              </button>
            </div>

          </div>
        </>
      )}

      {/* Desktop Click-away backdrop */}
      {(showUserMenu || showProjectMenu) && (
        <div className="fixed inset-0 z-30 hidden md:block" onClick={() => { setShowUserMenu(false); setShowProjectMenu(false); }} />
      )}
    </header>
  );
}
