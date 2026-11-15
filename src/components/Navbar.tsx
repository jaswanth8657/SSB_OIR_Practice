import React from 'react';
import { Shield, Clock, RotateCcw, Award, CheckCircle2 } from 'lucide-react';
import { OverallStats } from '../types/oir';

interface NavbarProps {
  stats: OverallStats;
  onOpenSettings: () => void;
  onGoHome: () => void;
  onResetData: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  stats,
  onOpenSettings,
  onGoHome,
  onResetData,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-14 sm:h-16 flex items-center justify-between gap-2">
        {/* Brand */}
        <div
          onClick={onGoHome}
          className="flex min-w-0 items-center gap-2 sm:gap-3 cursor-pointer group select-none"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-0.5 shadow-md shadow-blue-500/20 group-hover:shadow-blue-500/30 transition">
            <div className="w-full h-full bg-blue-600 rounded-[10px] flex items-center justify-center">
              <Shield className="w-5 h-5 text-white group-hover:scale-110 transition-transform" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-sm sm:text-lg tracking-wide sm:tracking-wider whitespace-nowrap text-slate-900 group-hover:text-blue-600 transition">
                OIR PREPARATION HUB
              </span>
              <span className="hidden sm:inline-flex px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                SSB Pro
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block font-medium">
              20 Sets • 1,000 Verified Questions • Strict Exam Timers
            </p>
          </div>
        </div>

        {/* Quick Stats & Actions */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-4">
          {/* Quick stats pill on medium+ screens */}
          <div className="hidden md:flex items-center gap-3 bg-slate-50 px-3.5 py-1.5 rounded-full border border-slate-200 text-xs font-semibold">
            <div className="flex items-center gap-1.5 text-slate-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Completed: <strong className="text-slate-900 font-bold">{stats.completedSets}/20</strong>
              </span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-slate-700">
              <Award className="w-3.5 h-3.5 text-amber-500" />
              <span>
                Accuracy: <strong className="text-slate-900 font-bold">{stats.overallAccuracy}%</strong>
              </span>
            </div>
          </div>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-11 rounded-xl bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-300 text-xs font-semibold transition cursor-pointer"
            title="Timer Settings"
          >
            <Clock className="w-4 h-4 text-blue-600" />
            <span className="hidden sm:inline">Timer Settings</span>
          </button>

          {/* Reset progress */}
          <button
            onClick={onResetData}
            className="p-2 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 transition cursor-pointer"
            title="Reset All Progress Data"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
