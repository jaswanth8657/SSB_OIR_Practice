import React, { useState } from 'react';
import {
  Shield,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  Trophy,
  Award,
  Layers,
  Sparkles,
  Search,
  Filter,
  BarChart3,
  BookOpen,
} from 'lucide-react';
import { PracticeSetMeta, SetProgress, OverallStats, UserSettings } from '../types/oir';

interface DashboardProps {
  sets: PracticeSetMeta[];
  progressMap: Record<number, SetProgress>;
  stats: OverallStats;
  settings: UserSettings;
  onSelectSet: (setNumber: number) => void;
  onViewSolutionsForSet: (setNumber: number) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  sets,
  progressMap,
  stats,
  settings,
  onSelectSet,
  onViewSolutionsForSet,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTab, setFilterTab] = useState<'all' | 'completed' | 'not_started'>('all');

  const filteredSets = sets.filter((s) => {
    const p = progressMap[s.setNumber];
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `set ${s.setNumber}`.includes(searchQuery.toLowerCase()) ||
      `set ${s.setNumber.toString().padStart(2, '0')}`.includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filterTab === 'completed') return p?.status === 'completed';
    if (filterTab === 'not_started') return !p || p.status === 'not_started';
    return true;
  });

  return (
    <div className="space-y-10 pb-16">
      {/* ----------------- HERO HEADER ----------------- */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950/80 to-slate-900 border border-slate-800/90 p-8 sm:p-12 shadow-2xl shadow-blue-950/30 ring-1 ring-white/5">
        {/* Decorative background blurs */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-0 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-cyan-400 text-xs font-bold tracking-wider uppercase shadow-sm">
            <Shield className="w-3.5 h-3.5 text-amber-400" />
            <span>Official SSB Officer Intelligence Rating Practice</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-sky-100 to-blue-200 tracking-tight leading-tight">
            OIR PREPARATION HUB
          </h1>

          <p className="text-base sm:text-xl text-amber-300 font-semibold italic">
            &ldquo;Practice Smart. Think Fast. Prepare to Lead.&rdquo;
          </p>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl">
            A comprehensive, high-fidelity platform containing all 20 verified OIR practice sets (1,000 verbal & non-verbal questions) from the original syllabus. Master strict time-per-question limits, test your pattern recognition, and earn an OIR 1 rating.
          </p>
        </div>
      </section>

      {/* ----------------- DYNAMIC STATISTICS COUNTERS ----------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <span>Practice Performance Overview</span>
          </h2>
          <span className="text-xs text-slate-400 font-mono">
            Live auto-calculating metrics
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* 1. Total Sets */}
          <div className="p-4 rounded-2xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg flex flex-col justify-between hover:border-blue-500/40 transition">
            <span className="text-xs font-semibold text-slate-400">Total Practice Sets</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
                {stats.totalPracticeSets}
              </span>
              <Layers className="w-5 h-5 text-cyan-400/80" />
            </div>
            <span className="text-[11px] text-slate-400 mt-1 font-medium">Full Curriculum</span>
          </div>

          {/* 2. Completed Sets */}
          <div className="p-4 rounded-2xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg flex flex-col justify-between hover:border-emerald-500/40 transition">
            <span className="text-xs font-semibold text-slate-400">Completed Sets</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono">
                {stats.completedSets}
              </span>
              <CheckCircle2 className="w-5 h-5 text-emerald-400/80" />
            </div>
            <span className="text-[11px] text-emerald-300/80 mt-1 font-medium">
              {Math.round((stats.completedSets / 20) * 100)}% coverage
            </span>
          </div>

          {/* 3. Total Attempts */}
          <div className="p-4 rounded-2xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg flex flex-col justify-between hover:border-indigo-500/40 transition">
            <span className="text-xs font-semibold text-slate-400">Total Attempts</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-indigo-400 font-mono">
                {stats.totalAttempts}
              </span>
              <RotateCcw className="w-5 h-5 text-indigo-400/80" />
            </div>
            <span className="text-[11px] text-indigo-300/80 mt-1 font-medium">Unlimited retakes</span>
          </div>

          {/* 4. Total Questions Practiced */}
          <div className="p-4 rounded-2xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg flex flex-col justify-between hover:border-amber-500/40 transition">
            <span className="text-xs font-semibold text-slate-400">Questions Practiced</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-400 font-mono">
                {stats.totalQuestionsPracticed}
              </span>
              <Sparkles className="w-5 h-5 text-amber-400/80" />
            </div>
            <span className="text-[11px] text-amber-300/80 mt-1 font-medium">Questions answered</span>
          </div>

          {/* 5. Overall Accuracy */}
          <div className="p-4 rounded-2xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg flex flex-col justify-between hover:border-teal-500/40 transition">
            <span className="text-xs font-semibold text-slate-400">Overall Accuracy</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-teal-400 font-mono">
                {stats.overallAccuracy}%
              </span>
              <Award className="w-5 h-5 text-teal-400/80" />
            </div>
            <span className="text-[11px] text-teal-300/80 mt-1 font-medium">
              Accuracy on answered
            </span>
          </div>

          {/* 6. Best Performance */}
          <div className="p-4 rounded-2xl bg-slate-900/90 backdrop-blur border border-slate-800 shadow-lg flex flex-col justify-between hover:border-amber-500/40 transition">
            <span className="text-xs font-semibold text-slate-400">Best Performance</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono">
                {stats.bestPerformance > 0 ? `${stats.bestPerformance}/50` : '--'}
              </span>
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-[11px] text-amber-300/80 mt-1 font-medium">Highest attempt score</span>
          </div>
        </div>
      </section>

      {/* ----------------- PRACTICE SET CARDS GRID ----------------- */}
      <section className="space-y-6">
        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              All 20 Practice Sets
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-cyan-400 text-xs font-mono font-bold border border-slate-700">
              {filteredSets.length} Sets
            </span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search sets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-500 text-xs text-white outline-none"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setFilterTab('all')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filterTab === 'all'
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterTab('completed')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filterTab === 'completed'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setFilterTab('not_started')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filterTab === 'not_started'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pending
              </button>
            </div>
          </div>
        </div>

        {/* 20 Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredSets.map((set) => {
            const pad = set.setNumber.toString().padStart(2, '0');
            const progress = progressMap[set.setNumber];
            const isCompleted = progress?.status === 'completed';
            const isInProgress = progress?.status === 'in_progress';

            let cardClasses =
              'border-slate-800/80 bg-slate-900/90 hover:border-cyan-500/50 hover:bg-slate-900 hover:shadow-cyan-500/5';
            let badgeClasses =
              'bg-blue-950/70 border-blue-700/50 text-cyan-300';
            let statusLabel = 'Not Started';

            if (isCompleted) {
              cardClasses =
                'border-emerald-600/70 bg-emerald-950/20 hover:border-emerald-500 hover:bg-emerald-950/30 shadow-lg shadow-emerald-950/20';
              badgeClasses =
                'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-extrabold';
              statusLabel = 'Completed';
            } else if (isInProgress) {
              cardClasses =
                'border-amber-600/70 bg-amber-950/20 hover:border-amber-500 hover:bg-amber-950/30 shadow-lg shadow-amber-950/20';
              badgeClasses =
                'bg-amber-500/20 border-amber-500/40 text-amber-300 font-extrabold';
              statusLabel = 'In Progress';
            }

            return (
              <div
                key={set.setNumber}
                className={`group relative rounded-2xl border p-5 shadow-xl transition-all duration-200 flex flex-col justify-between ring-1 ring-white/5 ${cardClasses}`}
              >
                <div>
                  {/* Card Header: Set Number & Status Badge */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-white font-mono font-extrabold flex items-center justify-center text-xs shadow-sm">
                        {pad}
                      </span>
                      <span className="font-bold text-sm text-slate-100 group-hover:text-amber-300 transition">
                        Set {pad}
                      </span>
                    </div>

                    {/* Status Badge */}
                    <div
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wider ${badgeClasses}`}
                    >
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Completed</span>
                        </>
                      ) : isInProgress ? (
                        <>
                          <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                          <span>In Progress</span>
                        </>
                      ) : (
                        <span>Not Started</span>
                      )}
                    </div>
                  </div>

                  {/* Card Details: Questions, Duration, Attempts, Best Score */}
                  <div className="py-4 space-y-2 text-xs text-slate-300 font-medium">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Total Questions:</span>
                      <strong className="text-white font-mono">50 Questions</strong>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Duration:</span>
                      <span className="text-slate-200 font-mono">
                        {settings.totalDurationMinutes} min ({settings.questionTimeSeconds}s/Q)
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Attempts:</span>
                      <span className="text-slate-200 font-mono">
                        {progress?.attemptsCount || 0}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Best Score:</span>
                      <strong
                        className={`font-mono text-sm ${
                          progress?.bestScore !== undefined
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {progress?.bestScore !== undefined
                          ? `${progress.bestScore}/${set.setNumber === 6 ? '49' : '50'}`
                          : '--'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <button
                    onClick={() => onSelectSet(set.setNumber)}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs shadow-md transition cursor-pointer ${
                      isCompleted
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-700/20'
                        : isInProgress
                        ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-700/20'
                        : 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-blue-600/20'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {isInProgress
                        ? 'Resume Test'
                        : isCompleted
                        ? 'Retake Test'
                        : 'Start Practice'}
                    </span>
                  </button>

                  {isCompleted && (
                    <button
                      onClick={() => onViewSolutionsForSet(set.setNumber)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-semibold transition cursor-pointer"
                    >
                      <BookOpen className="w-3 h-3 text-amber-400" />
                      <span>Review Solutions</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
