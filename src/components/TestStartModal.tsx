import React from 'react';
import { Play, ArrowLeft, Clock, Timer, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { PracticeSetMeta, UserSettings, SetProgress } from '../types/oir';

interface TestStartModalProps {
  setMeta: PracticeSetMeta;
  settings: UserSettings;
  progress?: SetProgress;
  onStart: () => void;
  onBack: () => void;
}

export const TestStartModal: React.FC<TestStartModalProps> = ({
  setMeta,
  settings,
  progress,
  onStart,
  onBack,
}) => {
  const pad = setMeta.setNumber.toString().padStart(2, '0');
  const isRetake = progress && progress.attemptsCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 sm:p-8 text-slate-100 overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-32 -left-32 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Back Link */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white mb-4 transition cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Dashboard</span>
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold tracking-wider uppercase mb-2">
              SSB Official Pattern
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              OIR PRACTICE TEST – SET {pad}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Officer Intelligence Rating Verbal & Non-Verbal Evaluation
            </p>
          </div>

          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
            <span className="font-extrabold text-xl font-mono">{pad}</span>
          </div>
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-6">
          <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              <span>Questions</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {setMeta.totalQuestions}
            </div>
            <div className="text-[11px] text-slate-400">Verbal & Visual</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span>Question Limit</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {settings.questionTimeSeconds}s
            </div>
            <div className="text-[11px] text-slate-400">Auto-moves on 0</div>
          </div>

          <div className="col-span-2 sm:col-span-1 p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Total Duration</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {settings.totalDurationMinutes}m
            </div>
            <div className="text-[11px] text-slate-400">Auto-submit at 0</div>
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-slate-800 text-xs text-slate-300">
          <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span>Important Test Instructions</span>
          </h3>
          <ul className="space-y-1.5 list-disc list-inside text-slate-300">
            <li>
              <strong>Marking Scheme:</strong> +1 mark for each correct answer. <strong>No negative marking</strong>.
            </li>
            <li>
              <strong>Dual Independent Timers:</strong> Both the question countdown and the overall test countdown run simultaneously.
            </li>
            <li>
              <strong>Pacing:</strong> When the question timer reaches 0, it saves unanswered and automatically advances to the next question.
            </li>
            <li>
              <strong>Review & Skip:</strong> You can skip questions and navigate back using the Previous button.
            </li>
            <li>
              <strong>Anti-Cheat Persistence:</strong> Timers use absolute timestamps and will not reset if the browser is refreshed.
            </li>
            {isRetake && (
              <li className="text-amber-300">
                You have previously attempted this set {progress.attemptsCount} time(s). Best score: {progress.bestScore}/50.
              </li>
            )}
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row items-center gap-3">
          <button
            onClick={onBack}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-semibold text-xs transition cursor-pointer text-center"
          >
            Back to Dashboard
          </button>
          <button
            onClick={onStart}
            className="w-full sm:flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-amber-500 hover:from-blue-500 hover:to-amber-400 text-white font-extrabold text-sm shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 transition cursor-pointer tracking-wide"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{isRetake ? 'Start Retake Test' : 'Start Test Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
