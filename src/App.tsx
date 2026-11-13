import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { TestStartModal } from './components/TestStartModal';
import { ExamInterface } from './components/ExamInterface';
import { ResultsPage } from './components/ResultsPage';
import { SolutionsPage } from './components/SolutionsPage';
import { SettingsModal } from './components/SettingsModal';

import {
  PracticeSetMeta,
  Question,
  TestAttempt,
  UserSettings,
  SetProgress,
  ActiveExamState,
  OverallStats,
} from './types/oir';

import { getSetsSummary, getQuestionsForSet } from './data/oirLoader';
import {
  getUserSettings,
  saveUserSettings,
  resetUserSettings,
  getAllSetProgress,
  getOverallStats,
  getActiveExam,
  getAttemptsForSet,
  clearAllUserData,
  clearActiveExam,
  checkAndRecoverExpiredExam,
} from './utils/storage';

export const App: React.FC = () => {
  // Practice sets summary (all 20 sets)
  const setsSummary = useMemo<PracticeSetMeta[]>(() => getSetsSummary(), []);

  // Application view state: 'dashboard' | 'start_modal' | 'exam' | 'results' | 'solutions'
  const [currentView, setCurrentView] = useState<
    'dashboard' | 'start_modal' | 'exam' | 'results' | 'solutions'
  >('dashboard');

  // Currently active set number (1 to 20)
  const [activeSetNumber, setActiveSetNumber] = useState<number>(1);

  // Active set questions
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);

  // User Settings (Question Timer, Total Duration)
  const [settings, setSettings] = useState<UserSettings>(() => getUserSettings());

  // Settings Modal visibility
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Reset confirmation modal visibility
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);

  // Set Progress Map and Overall Stats
  const [progressMap, setProgressMap] = useState<Record<number, SetProgress>>(() =>
    getAllSetProgress()
  );
  const [overallStats, setOverallStats] = useState<OverallStats>(() => getOverallStats());

  // Active attempt (for Results and Solutions)
  const [activeAttempt, setActiveAttempt] = useState<TestAttempt | null>(null);

  // Active Exam state if resuming
  const [resumedExamState, setResumedExamState] = useState<ActiveExamState | null>(null);

  // TASK 4: Expired exam recovery errors map (setNumber -> error message)
  const [recoveryErrors, setRecoveryErrors] = useState<Record<number, string>>({});

  // Refresh progress & stats
  const refreshUserData = () => {
    setProgressMap(getAllSetProgress());
    setOverallStats(getOverallStats());
  };

  // Defect 5: Listen for cross-tab recovery coordination via BroadcastChannel and storage events
  useEffect(() => {
    const handleRecoverySync = (data: any) => {
      if (!data || data.type !== 'EXAM_RECOVERED' || typeof data.setNumber !== 'number') {
        return;
      }
      const setNum = data.setNumber;
      refreshUserData();
      setRecoveryErrors((prev) => {
        if (!prev[setNum]) return prev;
        const updated = { ...prev };
        delete updated[setNum];
        return updated;
      });
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('oir_recovery_channel');
        bc.onmessage = (event) => {
          handleRecoverySync(event.data);
        };
      } catch {
        bc = null;
      }
    }

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'oir_recovery_sync_event' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          handleRecoverySync(parsed);
        } catch {
          // Ignore
        }
      }
    };

    window.addEventListener('storage', handleStorageEvent);

    return () => {
      if (bc) {
        bc.close();
      }
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  // Check for any expired exams on mount, recover them, and automatically display Results (Tasks 2, 3, 4)
  useEffect(() => {
    let isCancelled = false;

    async function runStartupRecovery() {
      const recoveredList: TestAttempt[] = [];
      const newErrors: Record<number, string> = {};

      for (let s = 1; s <= 20; s++) {
        const active = await getActiveExam(s);
        if (active && active.examEndTime <= Date.now()) {
          const qList = getQuestionsForSet(s);
          try {
            const res = await checkAndRecoverExpiredExam(s, qList, settings);
            if (res.status === 'recovered' || res.status === 'already_recovered') {
              recoveredList.push(res.attempt);
            } else if (res.status === 'storage_error' || res.status === 'lock_unavailable' || res.status === 'recovery_in_progress') {
              newErrors[s] =
                res.status === 'recovery_in_progress'
                  ? `Recovery for Set ${s} is in progress in another tab.`
                  : res.message;
            }
          } catch (err: any) {
            newErrors[s] = err?.message || `Failed to recover examination for Set ${s}`;
          }
        }
      }

      if (isCancelled) return;

      if (Object.keys(newErrors).length > 0) {
        setRecoveryErrors((prev) => ({ ...prev, ...newErrors }));
      }

      if (recoveredList.length > 0) {
        refreshUserData();
        // Sort to present the most recently expired test first while retaining all in history
        recoveredList.sort((a, b) => b.timestamp - a.timestamp);
        const latest = recoveredList[0];
        setActiveSetNumber(latest.setNumber);
        setActiveQuestions(getQuestionsForSet(latest.setNumber));
        setActiveAttempt(latest);
        setCurrentView('results');
      }
    }

    runStartupRecovery();

    return () => {
      isCancelled = true;
    };
  }, [settings]);

  // ----------------- ACTIONS & VIEW ROUTING -----------------

  // Click on a set card from the Dashboard
  const handleSelectSet = async (setNumber: number) => {
    setActiveSetNumber(setNumber);
    const questions = getQuestionsForSet(setNumber);
    setActiveQuestions(questions);

    // Check if there is an active saved exam for this set
    const savedExam = await getActiveExam(setNumber);
    if (savedExam) {
      // Check if it has expired while user was away
      if (savedExam.examEndTime <= Date.now()) {
        try {
          const res = await checkAndRecoverExpiredExam(setNumber, questions, settings);
          if (res.status === 'recovered' || res.status === 'already_recovered') {
            setRecoveryErrors((prev) => {
              const updated = { ...prev };
              delete updated[setNumber];
              return updated;
            });
            refreshUserData();
            handleExamFinish(res.attempt);
            return;
          } else if (
            res.status === 'storage_error' ||
            res.status === 'lock_unavailable' ||
            res.status === 'recovery_in_progress'
          ) {
            // DEFECT 2: CRITICAL - MUST REMAIN ON DASHBOARD!
            setRecoveryErrors((prev) => ({
              ...prev,
              [setNumber]:
                res.status === 'recovery_in_progress'
                  ? `Recovery for Set ${setNumber} is in progress in another tab.`
                  : res.message,
            }));
            refreshUserData();
            return; // Never navigate to exam or start a fresh session!
          } else if (res.status === 'no_active_exam') {
            refreshUserData();
            return; // Another tab completed recovery; stay on dashboard
          }
        } catch (err: any) {
          setRecoveryErrors((prev) => ({
            ...prev,
            [setNumber]: err?.message || `Failed to recover examination for Set ${setNumber}`,
          }));
          refreshUserData();
          return;
        }
      } else {
        // Unexpired active exam: safely resume
        setResumedExamState(savedExam);
        setCurrentView('exam');
        return;
      }
    } else {
      setResumedExamState(null);
      setCurrentView('start_modal');
    }
  };

  // Retry recovery for a specific set (Task 4)
  const handleRetryRecovery = async (setNumber: number) => {
    const questions = getQuestionsForSet(setNumber);
    try {
      const res = await checkAndRecoverExpiredExam(setNumber, questions, settings);
      if (res.status === 'recovered' || res.status === 'already_recovered') {
        setRecoveryErrors((prev) => {
          const updated = { ...prev };
          delete updated[setNumber];
          return updated;
        });
        refreshUserData();
        handleExamFinish(res.attempt);
      } else if (res.status === 'storage_error' || res.status === 'lock_unavailable') {
        setRecoveryErrors((prev) => ({ ...prev, [setNumber]: res.message }));
      }
    } catch (err: any) {
      setRecoveryErrors((prev) => ({
        ...prev,
        [setNumber]: err?.message || `Failed to recover examination for Set ${setNumber}`,
      }));
    }
  };

  // Start exam from TestStartModal
  const handleStartExam = () => {
    // Clear any previous attempt state
    clearActiveExam(activeSetNumber);
    setResumedExamState(null);
    setCurrentView('exam');
  };

  // Exam completed (either manual submit or overall timer expired)
  const handleExamFinish = (attempt: TestAttempt) => {
    setActiveAttempt(attempt);
    refreshUserData();
    setCurrentView('results');
  };

  // Review solutions from Results page or Dashboard card
  const handleViewSolutions = (setNumber: number, attempt?: TestAttempt) => {
    setActiveSetNumber(setNumber);
    const questions = getQuestionsForSet(setNumber);
    setActiveQuestions(questions);

    if (attempt) {
      setActiveAttempt(attempt);
    } else {
      // Find the most recent attempt for this set
      const attempts = getAttemptsForSet(setNumber);
      if (attempts.length > 0) {
        setActiveAttempt(attempts[attempts.length - 1]);
      } else {
        setActiveAttempt(null);
      }
    }
    setCurrentView('solutions');
  };

  // Attempt Again
  const handleAttemptAgain = (setNumber: number) => {
    clearActiveExam(setNumber);
    setResumedExamState(null);
    setActiveSetNumber(setNumber);
    const questions = getQuestionsForSet(setNumber);
    setActiveQuestions(questions);
    setCurrentView('exam');
  };

  // Next Set / Previous Set from Results
  const handleGoNextSet = () => {
    if (activeSetNumber < 20) {
      const nextNum = activeSetNumber + 1;
      setActiveSetNumber(nextNum);
      const questions = getQuestionsForSet(nextNum);
      setActiveQuestions(questions);
      setCurrentView('start_modal');
    }
  };

  const handleGoPreviousSet = () => {
    if (activeSetNumber > 1) {
      const prevNum = activeSetNumber - 1;
      setActiveSetNumber(prevNum);
      const questions = getQuestionsForSet(prevNum);
      setActiveQuestions(questions);
      setCurrentView('start_modal');
    }
  };

  // Reset all data
  const handleConfirmReset = () => {
    clearAllUserData();
    refreshUserData();
    setIsResetConfirmOpen(false);
    setCurrentView('dashboard');
  };

  // Save Settings
  const handleSaveSettings = (newSettings: Partial<UserSettings>) => {
    const updated = saveUserSettings(newSettings);
    setSettings(updated);
  };

  // Reset Settings to Default
  const handleResetSettings = () => {
    const def = resetUserSettings();
    setSettings(def);
  };

  // Active Set Meta
  const activeSetMeta =
    setsSummary.find((s) => s.setNumber === activeSetNumber) || setsSummary[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Navbar: visible on dashboard or when viewing results/solutions */}
      {currentView !== 'exam' && (
        <Navbar
          stats={overallStats}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onGoHome={() => setCurrentView('dashboard')}
          onResetData={() => setIsResetConfirmOpen(true)}
        />
      )}

      {/* Main Container */}
      <main className="flex-1 w-full">
        {/* 1. DASHBOARD VIEW */}
        {currentView === 'dashboard' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
            <Dashboard
              sets={setsSummary}
              progressMap={progressMap}
              stats={overallStats}
              settings={settings}
              recoveryErrors={recoveryErrors}
              onSelectSet={handleSelectSet}
              onViewSolutionsForSet={(sNum) => handleViewSolutions(sNum)}
              onRetryRecovery={handleRetryRecovery}
            />
          </div>
        )}

        {/* 2. TEST START SCREEN MODAL */}
        {currentView === 'start_modal' && activeSetMeta && (
          <TestStartModal
            setMeta={activeSetMeta}
            settings={settings}
            progress={progressMap[activeSetNumber]}
            onStart={handleStartExam}
            onBack={() => setCurrentView('dashboard')}
          />
        )}

        {/* 3. TIMED EXAM INTERFACE */}
        {currentView === 'exam' && activeQuestions.length > 0 && (
          <ExamInterface
            setNumber={activeSetNumber}
            questions={activeQuestions}
            settings={settings}
            initialState={resumedExamState}
            onFinish={handleExamFinish}
            onExit={() => {
              refreshUserData();
              setCurrentView('dashboard');
            }}
          />
        )}

        {/* 4. RESULTS PAGE */}
        {currentView === 'results' && activeAttempt && (
          <ResultsPage
            attempt={activeAttempt}
            onViewSolutions={() => setCurrentView('solutions')}
            onAttemptAgain={() => handleAttemptAgain(activeSetNumber)}
            onGoDashboard={() => {
              refreshUserData();
              setCurrentView('dashboard');
            }}
            onGoPreviousSet={activeSetNumber > 1 ? handleGoPreviousSet : undefined}
            onGoNextSet={activeSetNumber < 20 ? handleGoNextSet : undefined}
            hasPreviousSet={activeSetNumber > 1}
            hasNextSet={activeSetNumber < 20}
          />
        )}

        {/* 5. SOLUTIONS & EXPLANATIONS PAGE */}
        {currentView === 'solutions' && activeQuestions.length > 0 && (
          <SolutionsPage
            setNumber={activeSetNumber}
            questions={activeQuestions}
            attempt={activeAttempt || undefined}
            onBackToResults={activeAttempt ? () => setCurrentView('results') : undefined}
            onBackToDashboard={() => {
              refreshUserData();
              setCurrentView('dashboard');
            }}
          />
        )}
      </main>

      {/* ----------------- TIMER SETTINGS MODAL ----------------- */}
      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        onReset={handleResetSettings}
      />

      {/* ----------------- RESET CONFIRMATION MODAL ----------------- */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 text-slate-100 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-rose-400">
              Reset All Progress?
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              This action will reset all attempt histories, accuracy metrics, and completed statuses across all 20 practice sets. This cannot be undone.
            </p>
            <div className="pt-2 flex items-center gap-3">
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReset}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-600/30 transition cursor-pointer"
              >
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
