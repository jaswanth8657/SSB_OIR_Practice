import React from 'react';
import {
  Trophy,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  RotateCcw,
  BookOpen,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  Award,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { TestAttempt } from '../types/oir';

interface ResultsPageProps {
  attempt: TestAttempt;
  onViewSolutions: () => void;
  onAttemptAgain: () => void;
  onGoDashboard: () => void;
  onGoPreviousSet?: () => void;
  onGoNextSet?: () => void;
  hasPreviousSet: boolean;
  hasNextSet: boolean;
}

export const ResultsPage: React.FC<ResultsPageProps> = ({
  attempt,
  onViewSolutions,
  onAttemptAgain,
  onGoDashboard,
  onGoPreviousSet,
  onGoNextSet,
  hasPreviousSet,
  hasNextSet,
}) => {
  const pad = attempt.setNumber.toString().padStart(2, '0');

  // Format time taken
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Circular progress calculation (SVG radius 54, circumference 2 * PI * 54 = 339.29)
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (attempt.accuracyPercentage / 100) * circumference;

  // Unofficial practice benchmark based on candidate simulation
  let benchmarkRating = 'OIR - 5';
  let benchmarkLabel = 'Below Average';
  let benchmarkBadgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
  let benchmarkGlow = 'bg-rose-500/10';

  if (attempt.accuracyPercentage >= 85) {
    benchmarkRating = 'OIR - 1';
    benchmarkLabel = 'Outstanding';
    benchmarkBadgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    benchmarkGlow = 'bg-emerald-500/10';
  } else if (attempt.accuracyPercentage >= 75) {
    benchmarkRating = 'OIR - 2';
    benchmarkLabel = 'Excellent';
    benchmarkBadgeColor = 'bg-teal-500/20 text-teal-300 border-teal-500/30';
    benchmarkGlow = 'bg-teal-500/10';
  } else if (attempt.accuracyPercentage >= 60) {
    benchmarkRating = 'OIR - 3';
    benchmarkLabel = 'Above Average';
    benchmarkBadgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    benchmarkGlow = 'bg-blue-500/10';
  } else if (attempt.accuracyPercentage >= 50) {
    benchmarkRating = 'OIR - 4';
    benchmarkLabel = 'Average';
    benchmarkBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    benchmarkGlow = 'bg-amber-500/10';
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto w-full space-y-6 animate-in fade-in duration-300">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-mono font-semibold text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>OFFICER INTELLIGENCE RATING (OIR) REPORT</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            SET {pad} – TEST COMPLETED
          </h1>
          <p className="text-sm text-slate-400">
            Performance analytics, speed assessment, and accuracy breakdown
          </p>
        </div>

        {/* Primary Scorecard */}
        <div className="relative bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden">
          {/* Background glows */}
          <div className={`absolute -top-32 -right-32 w-64 h-64 ${benchmarkGlow} rounded-full blur-3xl pointer-events-none`} />
          <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Top Rating Banner */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Trophy className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 uppercase font-semibold tracking-wider flex items-center gap-1.5">
                  <span>Unofficial Practice Assessment Benchmark</span>
                </div>
                <div className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span className="text-blue-400">{benchmarkRating}</span>
                  <span className="text-slate-400 font-normal">({benchmarkLabel})</span>
                </div>
              </div>
            </div>

            <div className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider ${benchmarkBadgeColor} flex items-center gap-2`}>
              <Award className="w-4 h-4" />
              <span>Score: {attempt.score} / {attempt.totalQuestions}</span>
            </div>
          </div>

          {/* Central Analytics Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6 items-center">
            {/* Circular Accuracy Indicator */}
            <div className="flex flex-col items-center justify-center">
              <div className="relative w-36 h-36 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                  {/* Background Track */}
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    className="stroke-slate-800"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  {/* Progress Arc */}
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    className="stroke-emerald-500 transition-all duration-1000 ease-out"
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                  />
                </svg>

                {/* Center text */}
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-extrabold text-white font-mono">
                    {attempt.accuracyPercentage}%
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    Accuracy
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics Breakdown (Correct, Incorrect, Unanswered) */}
            <div className="col-span-1 md:col-span-2 grid grid-cols-3 gap-3">
              {/* Correct */}
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800/50 flex flex-col items-center text-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mb-1" />
                <span className="text-xs text-emerald-300/80 font-medium">Correct</span>
                <span className="text-2xl font-extrabold text-emerald-400 font-mono mt-1">
                  {attempt.correctAnswers}
                </span>
                <span className="text-[10px] text-emerald-400/60 font-mono mt-0.5">
                  +{attempt.correctAnswers} Marks
                </span>
              </div>

              {/* Incorrect */}
              <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800/50 flex flex-col items-center text-center">
                <XCircle className="w-6 h-6 text-rose-400 mb-1" />
                <span className="text-xs text-rose-300/80 font-medium">Incorrect</span>
                <span className="text-2xl font-extrabold text-rose-400 font-mono mt-1">
                  {attempt.incorrectAnswers}
                </span>
                <span className="text-[10px] text-rose-400/60 font-mono mt-0.5">
                  0 Negative
                </span>
              </div>

              {/* Unanswered */}
              <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/50 flex flex-col items-center text-center">
                <HelpCircle className="w-6 h-6 text-amber-400 mb-1" />
                <span className="text-xs text-amber-300/80 font-medium">Unanswered</span>
                <span className="text-2xl font-extrabold text-amber-400 font-mono mt-1">
                  {attempt.unansweredQuestions}
                </span>
                <span className="text-[10px] text-amber-400/60 font-mono mt-0.5">
                  Skipped / Expired
                </span>
              </div>

              {/* Time Taken */}
              <div className="col-span-3 p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between text-xs font-medium">
                <div className="flex items-center gap-2 text-slate-300">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <span>Time Consumed:</span>
                  <strong className="text-white font-mono text-sm">
                    {formatTime(attempt.timeTakenSeconds)}
                  </strong>
                </div>
                <div className="text-slate-400">
                  Avg Pace:{' '}
                  <span className="text-slate-200 font-mono">
                    {Math.round(attempt.timeTakenSeconds / Math.max(1, attempt.totalQuestions))}s / question
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Official SSB OIR Rating Standards (From PDF Reference Page 7) */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5 my-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
              <Info className="w-4 h-4 text-blue-400" />
              <span>Official SSB OIR Rating Scale (Reference – Test Booklet Page 7)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-900/40">
                <div className="font-bold text-emerald-300 font-mono">OIR - 1</div>
                <div className="text-[11px] text-slate-400">Outstanding</div>
              </div>
              <div className="p-2 rounded-lg bg-teal-950/30 border border-teal-900/40">
                <div className="font-bold text-teal-300 font-mono">OIR - 2</div>
                <div className="text-[11px] text-slate-400">Excellent</div>
              </div>
              <div className="p-2 rounded-lg bg-blue-950/30 border border-blue-900/40">
                <div className="font-bold text-blue-300 font-mono">OIR - 3</div>
                <div className="text-[11px] text-slate-400">Above Average</div>
              </div>
              <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-900/40">
                <div className="font-bold text-amber-300 font-mono">OIR - 4</div>
                <div className="text-[11px] text-slate-400">Average</div>
              </div>
              <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-900/40 col-span-2 sm:col-span-1">
                <div className="font-bold text-rose-300 font-mono">OIR - 5</div>
                <div className="text-[11px] text-slate-400">Below Average</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed italic">
              * Note: The Services Selection Board (SSB) does not publish rigid percentage cutoffs. Assessment relies on relative grading determined by the assessor board based on overall batch performance. Percentage-based bands presented above are unofficial practice assessment benchmarks to guide your preparation pace.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* 1. View Solutions */}
              <button
                onClick={onViewSolutions}
                className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 transition cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>View All Solutions</span>
              </button>

              {/* 2. Attempt Again */}
              <button
                onClick={onAttemptAgain}
                className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 font-bold text-xs transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-amber-400" />
                <span>Attempt Again</span>
              </button>

              {/* 3. Return to Dashboard */}
              <button
                onClick={onGoDashboard}
                className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 font-bold text-xs transition cursor-pointer"
              >
                <LayoutDashboard className="w-4 h-4 text-blue-400" />
                <span>Dashboard</span>
              </button>
            </div>

            {/* Set Progression: Previous Set and Next Set */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={onGoPreviousSet}
                disabled={!hasPreviousSet}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  hasPreviousSet
                    ? 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous Set</span>
              </button>

              <span className="text-xs text-slate-500 font-mono">
                Set {pad} of 20
              </span>

              <button
                onClick={onGoNextSet}
                disabled={!hasNextSet}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  hasNextSet
                    ? 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                <span>Next Set</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
