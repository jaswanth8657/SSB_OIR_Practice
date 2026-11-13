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
  AlertTriangle,
} from 'lucide-react';
import { PracticeSetMeta, SetProgress, OverallStats, UserSettings } from '../types/oir';

interface DashboardProps {
  sets: PracticeSetMeta[];
  progressMap: Record<number, SetProgress>;
  stats: OverallStats;
  settings: UserSettings;
  recoveryErrors?: Record<number, string>;
  onSelectSet: (setNumber: number) => void;
  onViewSolutionsForSet: (setNumber: number) => void;
  onRetryRecovery?: (setNumber: number) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  sets,
  progressMap,
  stats,
  settings,
  recoveryErrors,
  onSelectSet,
  onViewSolutionsForSet,
  onRetryRecovery,
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
    <div className="space-y-10 pb-16 text-slate-900">
      {/* ----------------- RECOVERY ERROR ALERT BANNER (TASK 4) ----------------- */}
      {recoveryErrors && Object.keys(recoveryErrors).length > 0 && (
        <section
          role="alert"
          aria-live="polite"
          className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-6 shadow-sm space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="text-base font-bold text-amber-900">
                Examination Recovery Pending
              </h3>
              <p className="text-xs sm:text-sm text-amber-800 leading-relaxed font-medium">
                An expired examination is waiting to be recovered. Your saved answers are preserved. Please retry recovery to view your results.
              </p>
            </div>
          </div>

          <div className="divide-y divide-amber-200 border-t border-amber-200 pt-3 space-y-3">
            {Object.entries(recoveryErrors).map(([sNumStr, errMsg]) => {
              const sNum = parseInt(sNumStr, 10);
              return (
                <div
                  key={sNum}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 first:pt-0"
                >
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-amber-900 font-mono">
                      SET {sNum.toString().padStart(2, '0')} – Recovery Pending
                    </div>
                    <div className="text-[11px] text-amber-700">
                      {errMsg}
                    </div>
                  </div>
                  {onRetryRecovery && (
                    <button
                      type="button"
                      onClick={() => onRetryRecovery(sNum)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm shadow-amber-600/30 transition cursor-pointer self-start sm:self-auto"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry Recovery</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ----------------- HERO HEADER ----------------- */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-700 via-indigo-700 to-sky-600 text-white p-8 sm:p-12 shadow-xl shadow-blue-700/15">
        {/* Subtle decorative blurs */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-amber-400/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/20 border border-white/30 text-white text-xs font-bold tracking-wider uppercase backdrop-blur-sm shadow-sm">
            <Shield className="w-3.5 h-3.5 text-amber-300" />
            <span>Official SSB Officer Intelligence Rating Practice</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight drop-shadow-sm">
            OIR PREPARATION HUB
          </h1>

          <p className="text-base sm:text-xl text-amber-200 font-semibold italic">
            &ldquo;Practice Smart. Think Fast. Prepare to Lead.&rdquo;
          </p>

          <p className="text-xs sm:text-sm text-sky-100 leading-relaxed max-w-2xl font-medium">
            A comprehensive, high-fidelity platform containing all 20 verified OIR practice sets (1,000 verbal & non-verbal questions) from the original syllabus. Master strict time-per-question limits, test your pattern recognition, and earn an OIR 1 rating.
          </p>
        </div>
      </section>

      {/* ----------------- DYNAMIC STATISTICS COUNTERS ----------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <span>Practice Performance Overview</span>
          </h2>
          <span className="text-xs text-slate-500 font-mono font-medium">
            Live auto-calculating metrics
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* 1. Total Sets */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-blue-400 transition hover:shadow-md">
            <span className="text-xs font-semibold text-slate-500">Total Practice Sets</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono">
                {stats.totalPracticeSets}
              </span>
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-[11px] text-slate-500 mt-1 font-medium">Full Curriculum</span>
          </div>

          {/* 2. Completed Sets */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-emerald-400 transition hover:shadow-md">
            <span className="text-xs font-semibold text-slate-500">Completed Sets</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono">
                {stats.completedSets}
              </span>
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-[11px] text-emerald-700 mt-1 font-medium">
              {Math.round((stats.completedSets / 20) * 100)}% coverage
            </span>
          </div>

          {/* 3. Total Attempts */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-indigo-400 transition hover:shadow-md">
            <span className="text-xs font-semibold text-slate-500">Total Attempts</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-indigo-600 font-mono">
                {stats.totalAttempts}
              </span>
              <RotateCcw className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="text-[11px] text-indigo-700 mt-1 font-medium">Unlimited retakes</span>
          </div>

          {/* 4. Total Questions Practiced */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-amber-400 transition hover:shadow-md">
            <span className="text-xs font-semibold text-slate-500">Questions Practiced</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono">
                {stats.totalQuestionsPracticed}
              </span>
              <Sparkles className="w-5 h-5 text-amber-500" />
            </div>
            <span className="text-[11px] text-amber-700 mt-1 font-medium">Questions answered</span>
          </div>

          {/* 5. Overall Accuracy */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-teal-400 transition hover:shadow-md">
            <span className="text-xs font-semibold text-slate-500">Overall Accuracy</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-teal-600 font-mono">
                {stats.overallAccuracy}%
              </span>
              <Award className="w-5 h-5 text-teal-600" />
            </div>
            <span className="text-[11px] text-teal-700 mt-1 font-medium">
              Accuracy on answered
            </span>
          </div>

          {/* 6. Best Performance */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-amber-400 transition hover:shadow-md">
            <span className="text-xs font-semibold text-slate-500">Best Performance</span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono">
                {stats.bestPerformance > 0 ? `${stats.bestPerformance}/50` : '--'}
              </span>
              <Trophy className="w-5 h-5 text-amber-500" />
            </div>
            <span className="text-[11px] text-amber-700 mt-1 font-medium">Highest attempt score</span>
          </div>
        </div>
      </section>

      {/* ----------------- PRACTICE SET CARDS GRID ----------------- */}
      <section className="space-y-6">
        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
              All 20 Practice Sets
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-mono font-bold border border-blue-200">
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
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 text-xs text-slate-800 outline-none shadow-sm"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              <button
                onClick={() => setFilterTab('all')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filterTab === 'all'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterTab('completed')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filterTab === 'completed'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setFilterTab('not_started')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filterTab === 'not_started'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
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
              'border-slate-200 bg-white hover:border-blue-400 hover:shadow-lg shadow-sm';
            let badgeClasses =
              'bg-slate-100 border-slate-200 text-slate-600';

            if (isCompleted) {
              cardClasses =
                'border-emerald-300 bg-emerald-50/20 hover:border-emerald-400 hover:shadow-lg shadow-sm';
              badgeClasses =
                'bg-emerald-100 border-emerald-200 text-emerald-800 font-bold';
            } else if (isInProgress) {
              cardClasses =
                'border-amber-300 bg-amber-50/30 hover:border-amber-400 hover:shadow-lg shadow-sm';
              badgeClasses =
                'bg-amber-100 border-amber-200 text-amber-800 font-bold';
            }

            return (
              <div
                key={set.setNumber}
                className={`group relative rounded-2xl border p-5 transition-all duration-200 flex flex-col justify-between ${cardClasses}`}
              >
                <div>
                  {/* Card Header: Set Number & Status Badge */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-mono font-extrabold flex items-center justify-center text-xs shadow-sm">
                        {pad}
                      </span>
                      <span className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition">
                        Set {pad}
                      </span>
                    </div>

                    {/* Status Badge */}
                    <div
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wider ${badgeClasses}`}
                    >
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Completed</span>
                        </>
                      ) : isInProgress ? (
                        <>
                          <Clock className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                          <span>In Progress</span>
                        </>
                      ) : (
                        <span>Not Started</span>
                      )}
                    </div>
                  </div>

                  {/* Card Details: Questions, Duration, Attempts, Best Score */}
                  <div className="py-4 space-y-2 text-xs text-slate-600 font-medium">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Total Questions:</span>
                      <strong className="text-slate-900 font-mono">50 Questions</strong>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Duration:</span>
                      <span className="text-slate-700 font-mono">
                        {settings.totalDurationMinutes} min ({settings.questionTimeSeconds}s/Q)
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Attempts:</span>
                      <span className="text-slate-700 font-mono">
                        {progress?.attemptsCount || 0}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Best Score:</span>
                      <strong
                        className={`font-mono text-sm ${
                          progress?.bestScore !== undefined
                            ? 'text-emerald-600 font-bold'
                            : 'text-slate-400'
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
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  {recoveryErrors && recoveryErrors[set.setNumber] && onRetryRecovery ? (
                    <button
                      onClick={() => onRetryRecovery(set.setNumber)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm transition cursor-pointer bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-amber-500/20"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry Recovery</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => onSelectSet(set.setNumber)}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm transition cursor-pointer ${
                        isCompleted
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-emerald-500/20'
                          : isInProgress
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-amber-500/20'
                          : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-500/20'
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
                  )}

                  {isCompleted && (
                    <button
                      onClick={() => onViewSolutionsForSet(set.setNumber)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200 text-[11px] font-semibold transition cursor-pointer"
                    >
                      <BookOpen className="w-3 h-3 text-amber-500" />
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
