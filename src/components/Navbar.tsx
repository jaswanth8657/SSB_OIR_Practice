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
    <header className="sticky top-0 z-40 w-full bg-slate-900/95 backdrop-blur border-b border-slate-800 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div
          onClick={onGoHome}
          className="flex items-center gap-3 cursor-pointer group select-none"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-amber-500 p-0.5 shadow-md shadow-blue-500/20 group-hover:shadow-blue-500/40 transition">
            <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center">
              <Shield className="w-5 h-5 text-amber-400 group-hover:scale-110 transition-transform" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-wider text-slate-100 group-hover:text-amber-400 transition">
                OIR PREPARATION HUB
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full">
                SSB Pro
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              20 Sets • 1,000 Verified Questions • Strict Exam Timers
            </p>
          </div>
        </div>

        {/* Quick Stats & Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Quick stats pill on medium+ screens */}
          <div className="hidden md:flex items-center gap-3 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/60 text-xs">
            <div className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Completed: <strong className="text-white">{stats.completedSets}/20</strong>
              </span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Accuracy: <strong className="text-white">{stats.overallAccuracy}%</strong>
              </span>
            </div>
          </div>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 hover:border-slate-600 text-xs font-medium transition cursor-pointer"
            title="Timer Settings"
          >
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="hidden sm:inline">Timer Settings</span>
          </button>

          {/* Reset progress */}
          <button
            onClick={onResetData}
            className="p-2 rounded-lg bg-slate-800/60 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700/60 hover:border-rose-800/50 transition cursor-pointer"
            title="Reset All Progress Data"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
