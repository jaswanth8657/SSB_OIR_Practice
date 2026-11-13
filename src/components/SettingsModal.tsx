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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 text-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Timer Configuration</h2>
              <p className="text-xs text-slate-500">Customize OIR exam pace & duration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="mt-5 space-y-5">
          {/* Setting 1: Question Timer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800">
                Time Per Question
              </label>
              <span className="text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
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
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white text-slate-900 font-mono text-base outline-none transition"
                required
              />
              <span className="absolute right-4 text-xs font-medium text-slate-500 uppercase tracking-wider pointer-events-none">
                Seconds
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              When this timer hits zero, the test automatically saves and moves to the next question.
            </p>
          </div>

          {/* Setting 2: Overall Duration */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-800">
                Overall Test Duration
              </label>
              <span className="text-xs font-mono text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
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
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white text-slate-900 font-mono text-base outline-none transition"
                required
              />
              <span className="absolute right-4 text-xs font-medium text-slate-500 uppercase tracking-wider pointer-events-none">
                Minutes
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              When the overall timer expires, the test immediately auto-submits and computes your score.
            </p>
          </div>

          {/* Alert feedback */}
          {savedAlert && (
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Settings saved successfully! Updating test presets...</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Default</span>
            </button>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-600/30 transition cursor-pointer"
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
