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
  AlertCircle,
  Sparkles,
  Target,
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
  const maxScore = attempt.maxScore ?? (attempt.totalQuestions - (attempt.excludedQuestions ?? 0));
  const excludedCount = attempt.excludedQuestions ?? 0;

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

  // Practice benchmark based on official SSB guidelines
  let benchmarkRating = 'OIR - 5';
  let benchmarkLabel = 'Below Average';
  let benchmarkBadgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-rose-500/10';
  let benchmarkGlow = 'bg-rose-500/15';

  if (attempt.accuracyPercentage >= 85) {
    benchmarkRating = 'OIR - 1';
    benchmarkLabel = 'Outstanding';
    benchmarkBadgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10';
    benchmarkGlow = 'bg-emerald-500/20';
  } else if (attempt.accuracyPercentage >= 75) {
    benchmarkRating = 'OIR - 2';
    benchmarkLabel = 'Excellent';
    benchmarkBadgeColor = 'bg-teal-500/20 text-teal-300 border-teal-500/40 shadow-teal-500/10';
    benchmarkGlow = 'bg-teal-500/20';
  } else if (attempt.accuracyPercentage >= 60) {
    benchmarkRating = 'OIR - 3';
    benchmarkLabel = 'Above Average';
    benchmarkBadgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/40 shadow-blue-500/10';
    benchmarkGlow = 'bg-blue-500/20';
  } else if (attempt.accuracyPercentage >= 50) {
    benchmarkRating = 'OIR - 4';
    benchmarkLabel = 'Average';
    benchmarkBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-500/10';
    benchmarkGlow = 'bg-amber-500/20';
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto w-full space-y-6 animate-in fade-in duration-300">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-xs font-mono font-semibold text-blue-700 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>OFFICER INTELLIGENCE RATING (OIR) REPORT</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            SET {pad} – TEST COMPLETED
          </h1>
          <p className="text-sm text-slate-600">
            Performance analytics, speed assessment, and accuracy breakdown
          </p>
        </div>

        {/* Primary Scorecard */}
        <div className="relative bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm overflow-hidden">
          {/* Top Rating Banner */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-sm">
                <Trophy className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>SSB Assessment Benchmark</span>
                </div>
                <div className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-blue-700 font-extrabold">{benchmarkRating}</span>
                  <span className="text-slate-600 font-normal">({benchmarkLabel})</span>
                </div>
              </div>
            </div>

            <div className={`px-4 py-2.5 rounded-xl border text-xs font-extrabold uppercase tracking-wider ${benchmarkBadgeColor} flex items-center gap-2 shadow-sm`}>
              <Award className="w-4 h-4" />
              <span>Score: {attempt.score} / {maxScore}</span>
            </div>
          </div>

          {/* Set 06 Question 11 Exclusion Alert if applicable */}
          {excludedCount > 0 && (
            <div className="mt-4 p-3.5 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-purple-800">Scoring Exclusion Note: </span>
                <span>
                  Question 11 was excluded from scoring due to ambiguous options in the source reference key. Maximum score is adjusted to {maxScore}.
                </span>
                <span className="block mt-1 font-mono text-[11px] text-purple-700">
                  Total Questions: {attempt.totalQuestions} = Correct ({attempt.correctAnswers}) + Incorrect ({attempt.incorrectAnswers}) + Unanswered ({attempt.unansweredQuestions}) + Excluded ({excludedCount})
                </span>
              </div>
            </div>
          )}

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
                    className="stroke-slate-100"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  {/* Progress Arc */}
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    className="stroke-blue-600 transition-all duration-1000 ease-out"
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                  />
                </svg>

                {/* Center text */}
                <div className="absolute flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-extrabold text-slate-900 font-mono tracking-tight">
                    {attempt.accuracyPercentage}%
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-blue-700 flex items-center gap-1">
                    <Target className="w-3 h-3" /> Accuracy
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics Breakdown (Correct, Incorrect, Unanswered, Excluded) */}
            <div className={`col-span-1 md:col-span-2 grid ${excludedCount > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2.5 sm:gap-3`}>
              {/* Correct */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col items-center text-center shadow-sm">
                <CheckCircle2 className="w-5 sm:w-6 h-5 sm:h-6 text-emerald-600 mb-1" />
                <span className="text-[11px] sm:text-xs text-emerald-800 font-medium">Correct</span>
                <span className="text-2xl font-extrabold text-emerald-700 font-mono mt-1">
                  {attempt.correctAnswers}
                </span>
                <span className="text-[10px] text-emerald-600 font-mono mt-0.5">
                  +{attempt.correctAnswers} Marks
                </span>
              </div>

              {/* Incorrect */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col items-center text-center shadow-sm">
                <XCircle className="w-5 sm:w-6 h-5 sm:h-6 text-rose-600 mb-1" />
                <span className="text-[11px] sm:text-xs text-rose-800 font-medium">Incorrect</span>
                <span className="text-2xl font-extrabold text-rose-700 font-mono mt-1">
                  {attempt.incorrectAnswers}
                </span>
                <span className="text-[10px] text-rose-600 font-mono mt-0.5">
                  0 Negative
                </span>
              </div>

              {/* Unanswered */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col items-center text-center shadow-sm">
                <HelpCircle className="w-5 sm:w-6 h-5 sm:h-6 text-amber-600 mb-1" />
                <span className="text-[11px] sm:text-xs text-amber-800 font-medium">Unanswered</span>
                <span className="text-2xl font-extrabold text-amber-700 font-mono mt-1">
                  {attempt.unansweredQuestions}
                </span>
                <span className="text-[10px] text-amber-600 font-mono mt-0.5">
                  Skipped / Expired
                </span>
              </div>

              {/* Excluded (if any) */}
              {excludedCount > 0 && (
                <div className="p-3.5 sm:p-4 rounded-2xl bg-purple-50 border border-purple-200 flex flex-col items-center text-center shadow-sm">
                  <AlertCircle className="w-5 sm:w-6 h-5 sm:h-6 text-purple-600 mb-1" />
                  <span className="text-[11px] sm:text-xs text-purple-800 font-medium">Excluded</span>
                  <span className="text-2xl font-extrabold text-purple-700 font-mono mt-1">
                    {excludedCount}
                  </span>
                  <span className="text-[10px] text-purple-600 font-mono mt-0.5">
                    Not Scored
                  </span>
                </div>
              )}

              {/* Time Taken Row */}
              <div className={`${excludedCount > 0 ? 'col-span-2 sm:col-span-4' : 'col-span-3'} p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs font-medium`}>
                <div className="flex items-center gap-2 text-slate-700">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span>Time Consumed:</span>
                  <strong className="text-slate-900 font-mono text-sm">
                    {formatTime(attempt.timeTakenSeconds)}
                  </strong>
                </div>
                <div className="text-slate-500">
                  Avg Pace:{' '}
                  <span className="text-slate-700 font-mono">
                    {Math.round(attempt.timeTakenSeconds / Math.max(1, attempt.totalQuestions))}s / question
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Official SSB OIR Rating Standards (From PDF Reference Page 7) */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 my-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <Info className="w-4 h-4 text-blue-600" />
              <span>Official SSB OIR Rating Scale (Reference – Test Booklet Page 7)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <div className="font-bold text-emerald-700 font-mono">OIR - 1</div>
                <div className="text-[11px] text-slate-600">Outstanding</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <div className="font-bold text-teal-700 font-mono">OIR - 2</div>
                <div className="text-[11px] text-slate-600">Excellent</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <div className="font-bold text-blue-700 font-mono">OIR - 3</div>
                <div className="text-[11px] text-slate-600">Above Average</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
                <div className="font-bold text-amber-700 font-mono">OIR - 4</div>
                <div className="text-[11px] text-slate-600">Average</div>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-slate-200 col-span-2 sm:col-span-1 shadow-sm">
                <div className="font-bold text-rose-700 font-mono">OIR - 5</div>
                <div className="text-[11px] text-slate-600">Below Average</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed italic">
              * Note: The Services Selection Board (SSB) does not publish rigid percentage cutoffs. Assessment relies on relative grading determined by the assessor board based on overall batch performance. Percentage-based bands presented above are unofficial practice assessment benchmarks to guide your preparation pace.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* 1. View Solutions */}
              <button
                onClick={onViewSolutions}
                className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs shadow-sm shadow-blue-600/30 transition cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>View All Solutions</span>
              </button>

              {/* 2. Attempt Again */}
              <button
                onClick={onAttemptAgain}
                className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-300 font-bold text-xs transition cursor-pointer shadow-sm"
              >
                <RotateCcw className="w-4 h-4 text-amber-600" />
                <span>Attempt Again</span>
              </button>

              {/* 3. Return to Dashboard */}
              <button
                onClick={onGoDashboard}
                className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-300 font-bold text-xs transition cursor-pointer shadow-sm"
              >
                <LayoutDashboard className="w-4 h-4 text-blue-600" />
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
                    ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm'
                    : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous Set</span>
              </button>

              <span className="text-xs text-slate-500 font-mono font-semibold">
                Set {pad} of 20
              </span>

              <button
                onClick={onGoNextSet}
                disabled={!hasNextSet}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                  hasNextSet
                    ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm'
                    : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
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
