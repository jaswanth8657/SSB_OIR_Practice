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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-xl p-6 sm:p-8 text-slate-800 overflow-hidden">
        {/* Back Link */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4 transition cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Dashboard</span>
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold tracking-wider uppercase mb-2">
              SSB Official Pattern
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              OIR PRACTICE TEST – SET {pad}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Officer Intelligence Rating Verbal & Non-Verbal Evaluation
            </p>
          </div>

          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <span className="font-extrabold text-xl font-mono">{pad}</span>
          </div>
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-6">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Questions</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {setMeta.totalQuestions}
            </div>
            <div className="text-[11px] text-slate-500">Verbal & Visual</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Timer className="w-3.5 h-3.5 text-amber-600" />
              <span>Question Limit</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {settings.questionTimeSeconds}s
            </div>
            <div className="text-[11px] text-slate-500">Auto-moves on 0</div>
          </div>

          <div className="col-span-2 sm:col-span-1 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Total Duration</span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono">
              {settings.totalDurationMinutes}m
            </div>
            <div className="text-[11px] text-slate-500">Auto-submit at 0</div>
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-700">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span>Important Test Instructions</span>
          </h3>
          <ul className="space-y-1.5 list-disc list-inside text-slate-600">
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
              <li className="text-amber-800">
                You have previously attempted this set {progress.attemptsCount} time(s). Best score: {progress.bestScore}/50.
              </li>
            )}
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row items-center gap-3">
          <button
            onClick={onBack}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200 transition cursor-pointer text-center"
          >
            Back to Dashboard
          </button>
          <button
            onClick={onStart}
            className="w-full sm:flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm shadow-blue-600/30 transition cursor-pointer tracking-wide"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{isRetake ? 'Start Retake Test' : 'Start Test Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
