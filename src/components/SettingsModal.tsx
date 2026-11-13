import React, { useState } from 'react';
import { X, Clock, RotateCcw, Check, Sparkles } from 'lucide-react';
import { UserSettings } from '../types/oir';
import { DEFAULT_SETTINGS } from '../utils/storage';

interface SettingsModalProps {
  isOpen: boolean;
  settings: UserSettings;
  onClose: () => void;
  onSave: (newSettings: Partial<UserSettings>) => void;
  onReset: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSave,
  onReset,
}) => {
  const [questionTime, setQuestionTime] = useState<number>(settings.questionTimeSeconds);
  const [totalDuration, setTotalDuration] = useState<number>(settings.totalDurationMinutes);
  const [savedAlert, setSavedAlert] = useState<boolean>(false);

  // Sync state when modal opens
  React.useEffect(() => {
    setQuestionTime(settings.questionTimeSeconds);
    setTotalDuration(settings.totalDurationMinutes);
    setSavedAlert(false);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const qTime = Math.max(5, Math.min(300, Number(questionTime) || DEFAULT_SETTINGS.questionTimeSeconds));
    const dTime = Math.max(1, Math.min(180, Number(totalDuration) || DEFAULT_SETTINGS.totalDurationMinutes));

    onSave({
      questionTimeSeconds: qTime,
      totalDurationMinutes: dTime,
    });
    setSavedAlert(true);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleResetToDefault = () => {
    setQuestionTime(DEFAULT_SETTINGS.questionTimeSeconds);
    setTotalDuration(DEFAULT_SETTINGS.totalDurationMinutes);
    onReset();
    setSavedAlert(true);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 text-slate-100 overflow-hidden">
        {/* Background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Timer Configuration</h2>
              <p className="text-xs text-slate-400">Customize OIR exam pace & duration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="mt-5 space-y-5">
          {/* Setting 1: Question Timer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200">
                Time Per Question
              </label>
              <span className="text-xs font-mono text-blue-400 bg-blue-950/60 border border-blue-800/40 px-2 py-0.5 rounded-md">
                Default: 40 sec
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="number"
                min="5"
                max="300"
                value={questionTime}
                onChange={(e) => setQuestionTime(parseInt(e.target.value) || 0)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800/90 border border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-white font-mono text-base outline-none transition"
                required
              />
              <span className="absolute right-4 text-xs font-medium text-slate-400 uppercase tracking-wider pointer-events-none">
                Seconds
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              When this timer hits zero, the test automatically saves and moves to the next question.
            </p>
          </div>

          {/* Setting 2: Overall Duration */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200">
                Overall Test Duration
              </label>
              <span className="text-xs font-mono text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded-md">
                Default: 25 min
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="number"
                min="1"
                max="180"
                value={totalDuration}
                onChange={(e) => setTotalDuration(parseInt(e.target.value) || 0)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800/90 border border-slate-700 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 text-white font-mono text-base outline-none transition"
                required
              />
              <span className="absolute right-4 text-xs font-medium text-slate-400 uppercase tracking-wider pointer-events-none">
                Minutes
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              When the overall timer expires, the test immediately auto-submits and computes your score.
            </p>
          </div>

          {/* Alert feedback */}
          {savedAlert && (
            <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Settings saved successfully! Updating test presets...</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Default</span>
            </button>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/30 transition cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Save Settings</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
