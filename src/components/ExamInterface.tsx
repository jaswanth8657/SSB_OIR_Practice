import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clock,
  Timer,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  Send,
  ZoomIn,
  X,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Lock,
} from 'lucide-react';
import {
  Question,
  UserAnswer,
  UserSettings,
  ActiveExamState,
  TestAttempt,
} from '../types/oir';
import {
  saveActiveExam,
  clearActiveExam,
  saveAttempt,
} from '../utils/storage';
import { buildTestAttempt } from '../utils/scoring';
import {
  calculateQuestionRemaining,
  restoreQuestionTimerOnResume,
  switchQuestionTimer,
} from '../utils/timerUtils';

interface ExamInterfaceProps {
  setNumber: number;
  questions: Question[];
  settings: UserSettings;
  initialState?: ActiveExamState | null;
  onFinish: (attempt: TestAttempt) => void;
  onExit: () => void;
}

export const ExamInterface: React.FC<ExamInterfaceProps> = ({
  setNumber,
  questions,
  settings,
  initialState,
  onFinish,
  onExit,
}) => {
  const totalQuestions = questions.length;
  const isSubmittingRef = useRef<boolean>(false);

  // Active question index (0 to 49)
  const initialIndex = initialState
    ? Math.min(totalQuestions - 1, Math.max(0, initialState.currentQuestionIndex))
    : 0;
  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);

  // User answers map
  const [userAnswers, setUserAnswers] = useState<Record<number, UserAnswer>>(() => {
    if (initialState?.userAnswers) {
      return initialState.userAnswers;
    }
    const initialMap: Record<number, UserAnswer> = {};
    questions.forEach((q) => {
      initialMap[q.questionNumber] = {
        questionNumber: q.questionNumber,
        selectedOption: undefined,
        twoPartAnswer: undefined,
        dropdownSelection: undefined,
        isAnswered: false,
      };
    });
    return initialMap;
  });

  // Overall test timers
  const [examEndTime] = useState<number>(() => {
    if (initialState?.examEndTime && initialState.examEndTime > Date.now()) {
      return initialState.examEndTime;
    }
    return Date.now() + settings.totalDurationMinutes * 60 * 1000;
  });

  // TASK 1: Restore question timer state properly on mount / refresh
  const initialCurQ = questions[initialIndex]?.questionNumber || 1;
  const initialRestoration = restoreQuestionTimerOnResume(
    initialCurQ,
    initialState?.questionTimeLeft || {},
    initialState?.currentQuestionStartedAt || Date.now(),
    initialState?.questionExpiredMap || {},
    settings.questionTimeSeconds,
    Date.now()
  );

  // Persistent question timers map
  const [questionTimeLeft, setQuestionTimeLeft] = useState<Record<number, number>>(
    initialRestoration.updatedTimeLeft
  );

  // Questions whose timer has expired (time ran out)
  const [questionExpiredMap, setQuestionExpiredMap] = useState<Record<number, boolean>>(
    initialRestoration.updatedExpiredMap
  );

  // Timestamp when the currently active question started
  const [currentQuestionStartedAt, setCurrentQuestionStartedAt] = useState<number>(
    initialRestoration.newStartedAt
  );

  // Live countdown displays
  const [overallRemaining, setOverallRemaining] = useState<number>(() => {
    return Math.max(0, Math.floor((examEndTime - Date.now()) / 1000));
  });

  const [activeQuestionRemaining, setActiveQuestionRemaining] = useState<number>(
    initialRestoration.remainingSeconds
  );

  // Image zoom modal
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Submit confirmation modal
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // TASK 1: Submission persistence error state & saving indicator
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Current question object
  const currentQuestion = questions[currentIndex] || questions[0];
  const curQNum = currentQuestion.questionNumber;
  const isCurrentExpired = Boolean(questionExpiredMap[curQNum]);

  const currentAnswer = userAnswers[curQNum] || {
    questionNumber: curQNum,
    selectedOption: undefined,
    isAnswered: false,
  };

  // ----------------- SUBMISSION LOGIC (TASK 1) -----------------
  const submitExam = useCallback(
    (reason: 'manual' | 'overall_timer_expired' = 'manual') => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSaving(true);
      setSubmissionError(null);

      const totalTimeLimitSeconds = settings.totalDurationMinutes * 60;
      const timeTaken = Math.min(
        totalTimeLimitSeconds,
        Math.max(1, totalTimeLimitSeconds - overallRemaining)
      );

      const examSessionStart = examEndTime - totalTimeLimitSeconds * 1000;
      const stableAttemptId = `att_${setNumber}_${examSessionStart}`;

      const attempt = buildTestAttempt(
        setNumber,
        questions,
        userAnswers,
        timeTaken,
        stableAttemptId,
        Date.now()
      );

      const saveRes = saveAttempt(attempt);
      if (saveRes.success) {
        clearActiveExam(setNumber);
        setIsSaving(false);
        onFinish(attempt);
      } else {
        // Unlock submission ref so the candidate can retry saving
        isSubmittingRef.current = false;
        setIsSaving(false);
        console.error('Failed to persist attempt to localStorage:', saveRes.error);
        setSubmissionError(
          'Your examination could not be saved because browser storage is unavailable or full. Your answers have been preserved. Please retry saving your results.'
        );
      }
    },
    [questions, userAnswers, setNumber, settings, overallRemaining, examEndTime, onFinish]
  );

  // ----------------- NAVIGATION (TASK 1 & TASK 6) -----------------
  const switchQuestion = useCallback(
    (targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= totalQuestions) return;

      const now = Date.now();
      const fromQ = questions[currentIndex].questionNumber;
      const toQ = questions[targetIndex].questionNumber;

      const result = switchQuestionTimer(
        fromQ,
        currentQuestionStartedAt,
        toQ,
        questionTimeLeft,
        questionExpiredMap,
        settings.questionTimeSeconds,
        now
      );

      setQuestionTimeLeft(result.updatedTimeLeft);
      setQuestionExpiredMap(result.updatedExpiredMap);
      setCurrentIndex(targetIndex);
      setCurrentQuestionStartedAt(result.newStartedAt);
      setActiveQuestionRemaining(result.toQRemaining);
    },
    [currentIndex, questions, totalQuestions, currentQuestionStartedAt, questionTimeLeft, questionExpiredMap, settings.questionTimeSeconds]
  );

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      switchQuestion(currentIndex + 1);
    } else {
      setShowSubmitModal(true);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      switchQuestion(currentIndex - 1);
    }
  };

  const handleSkip = () => {
    if (currentIndex < totalQuestions - 1) {
      switchQuestion(currentIndex + 1);
    } else {
      setShowSubmitModal(true);
    }
  };

  // ----------------- ANSWER SELECTION HANDLERS -----------------

  // Single choice
  const handleSelectOption = (optionId: string) => {
    if (isCurrentExpired) return;
    setUserAnswers((prev) => ({
      ...prev,
      [curQNum]: {
        questionNumber: curQNum,
        selectedOption: optionId,
        isAnswered: true,
      },
    }));
  };

  // Multiple choice (Class A figures)
  const handleToggleMultiChoice = (optionId: string) => {
    if (isCurrentExpired) return;
    setUserAnswers((prev) => {
      const cur = prev[curQNum]?.selectedOption;
      let arr: string[] = Array.isArray(cur) ? [...cur] : cur ? [String(cur)] : [];
      if (arr.includes(optionId)) {
        arr = arr.filter((x) => x !== optionId);
      } else {
        if (arr.length < 2) {
          arr.push(optionId);
        } else {
          arr = [arr[1], optionId];
        }
      }
      return {
        ...prev,
        [curQNum]: {
          questionNumber: curQNum,
          selectedOption: arr,
          isAnswered: arr.length > 0,
        },
      };
    });
  };

  // TASK 2: Two-Part Answers (Q13 letter series & Q45 number series)
  const handleTwoPartChange = (partIndex: 0 | 1, val: string) => {
    if (isCurrentExpired) return;
    setUserAnswers((prev) => {
      const curParts = prev[curQNum]?.twoPartAnswer || ['', ''];
      const updatedParts: [string, string] = [curParts[0], curParts[1]];
      updatedParts[partIndex] = val;

      const hasBoth = updatedParts[0].trim().length > 0 && updatedParts[1].trim().length > 0;
      return {
        ...prev,
        [curQNum]: {
          questionNumber: curQNum,
          twoPartAnswer: updatedParts,
          selectedOption: `${updatedParts[0]}, ${updatedParts[1]}`,
          isAnswered: hasBoth,
        },
      };
    });
  };

  // TASK 3: Multi-Dropdown Sentence Completion (Q18)
  const handleDropdownSelect = (groupIndex: number, optionId: string) => {
    if (isCurrentExpired) return;
    setUserAnswers((prev) => {
      const curIds = prev[curQNum]?.dropdownSelection || ['', '', ''];
      const updatedIds = [...curIds];
      updatedIds[groupIndex] = optionId;

      const hasAllThree = updatedIds.filter(Boolean).length === 3;
      return {
        ...prev,
        [curQNum]: {
          questionNumber: curQNum,
          dropdownSelection: updatedIds,
          selectedOption: updatedIds,
          isAnswered: hasAllThree,
        },
      };
    });
  };

  // TASK 4: Numerical Arithmetic & Text Inputs
  const handleTextChange = (text: string) => {
    if (isCurrentExpired) return;
    setUserAnswers((prev) => ({
      ...prev,
      [curQNum]: {
        questionNumber: curQNum,
        selectedOption: text,
        isAnswered: text.trim().length > 0,
      },
    }));
  };

  // ----------------- LIVE TIMER TICK (TASK 6 & TASK 7) -----------------
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      // 1. Overall Timer
      const oRem = Math.max(0, Math.floor((examEndTime - now) / 1000));
      setOverallRemaining(oRem);

      if (oRem <= 0) {
        clearInterval(interval);
        submitExam('overall_timer_expired');
        return;
      }

      // 2. Active Question Timer (Task 1)
      if (!questionExpiredMap[curQNum]) {
        const budget = questionTimeLeft[curQNum] ?? settings.questionTimeSeconds;
        const { remainingSeconds, isExpired } = calculateQuestionRemaining(
          currentQuestionStartedAt,
          budget,
          now
        );
        setActiveQuestionRemaining(remainingSeconds);

        if (isExpired) {
          // Question expired!
          setQuestionExpiredMap((prev) => ({ ...prev, [curQNum]: true }));
          setQuestionTimeLeft((prev) => ({ ...prev, [curQNum]: 0 }));

          // Automatically advance to next question
          if (currentIndex < totalQuestions - 1) {
            switchQuestion(currentIndex + 1);
          } else {
            // Last question expired: check if all expired or submit
            submitExam('overall_timer_expired');
          }
        }
      } else {
        setActiveQuestionRemaining(0);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [examEndTime, curQNum, currentQuestionStartedAt, questionTimeLeft, questionExpiredMap, settings.questionTimeSeconds, currentIndex, totalQuestions, switchQuestion, submitExam]);

  // ----------------- STATE PERSISTENCE -----------------
  useEffect(() => {
    const activeState: ActiveExamState = {
      setNumber,
      currentQuestionIndex: currentIndex,
      userAnswers,
      examStartTime: examEndTime - settings.totalDurationMinutes * 60 * 1000,
      examEndTime,
      questionTimeLeft,
      currentQuestionStartedAt,
      questionExpiredMap,
    };
    saveActiveExam(activeState);
  }, [setNumber, currentIndex, userAnswers, examEndTime, questionTimeLeft, currentQuestionStartedAt, questionExpiredMap, settings]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100);
  const answeredCount = Object.values(userAnswers).filter((a) => a.isAnswered).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col select-none">
      {/* ----------------- TOP BAR ----------------- */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Set and Question Index */}
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-xs font-mono font-bold uppercase tracking-wider">
              SET {setNumber.toString().padStart(2, '0')}
            </span>
            <div className="text-sm font-bold text-slate-800">
              Question <span className="text-blue-600 font-mono text-base">{currentIndex + 1}</span> of{' '}
              <span className="text-slate-500 font-mono">{totalQuestions}</span>
            </div>
            {isCurrentExpired && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold uppercase">
                <Lock className="w-3 h-3 text-rose-500" /> Time Expired
              </span>
            )}
          </div>

          {/* Center/Right: Dual Independent Timers */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Question Countdown Timer (Task 6) */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-colors ${
                isCurrentExpired
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : activeQuestionRemaining <= 10
                  ? 'bg-rose-50 text-rose-600 border-rose-300 animate-pulse'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
              title="Persistent Question Countdown Timer"
            >
              <Timer className="w-3.5 h-3.5 text-amber-600" />
              <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1 text-[11px] sm:text-xs">
                <span className="text-slate-500 hidden sm:inline">Q-Timer:</span>
                <span>{activeQuestionRemaining}s</span>
              </div>
            </div>

            {/* Overall Countdown Timer */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-colors ${
                overallRemaining <= 120
                  ? 'bg-rose-50 text-rose-600 border-rose-300 animate-pulse'
                  : 'bg-blue-50 text-blue-800 border-blue-200'
              }`}
              title="Overall Test Time Remaining"
            >
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1 text-[11px] sm:text-xs">
                <span className="text-slate-500 hidden sm:inline">Overall:</span>
                <span>{formatTime(overallRemaining)}</span>
              </div>
            </div>

            {/* Submit / Finish button */}
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs shadow-sm shadow-emerald-700/20 transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Submit Test</span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-200 h-1.5 relative overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 h-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </header>

      {/* ----------------- QUESTION BODY ----------------- */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-between">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 shadow-sm space-y-6">
          {/* Metadata & Discrepancy Alert */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-blue-600 tracking-wide uppercase">
                {currentQuestion.type === 'two_part_letter'
                  ? 'Letter Series (Two-Part Answer)'
                  : currentQuestion.type === 'two_part_number'
                  ? 'Numerical Series (Two-Part Answer)'
                  : currentQuestion.type === 'numerical'
                  ? 'Arithmetic Missing Digit Calculation'
                  : currentQuestion.type === 'multiple_choice'
                  ? 'Class A Figure Classification'
                  : currentQuestion.type === 'boolean'
                  ? 'Cube Similarity (Yes / No)'
                  : currentQuestion.type === 'multi_dropdown'
                  ? 'Sentence Completion (3 Brackets)'
                  : currentQuestion.images.length > 0
                  ? 'Non-Verbal Visual Reasoning'
                  : 'Verbal Intelligence'}
              </span>
              <span className="text-slate-500 font-mono">
                Answered: {answeredCount}/{totalQuestions}
              </span>
            </div>

            {/* Flag Set 06 Q11 discrepancy note (Task 4 & Task 8) */}
            {currentQuestion.hasSourceDiscrepancy && (
              <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Source Discrepancy Flagged:</strong> {currentQuestion.sourceDiscrepancyNote}
                  {currentQuestion.scoringExcluded && (
                    <span className="block mt-1 text-purple-700 font-semibold">
                      This question is excluded from scoring so you will not be penalized.
                    </span>
                  )}
                </div>
              </div>
            )}

            {currentQuestion.instruction && (
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs sm:text-sm">
                <strong>Instruction:</strong> {currentQuestion.instruction}
              </div>
            )}

            {/* Question Statement */}
            <div className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
              <span className="font-mono text-blue-600 mr-2">{currentQuestion.questionNumber}.</span>
              {currentQuestion.statement}
            </div>
          </div>

          {/* ----------------- DIAGRAMS SECTION ----------------- */}
          {currentQuestion.images && currentQuestion.images.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Original Question Diagram ({currentQuestion.images.length})</span>
                <span className="text-[11px] text-blue-600 flex items-center gap-1 font-semibold">
                  <ZoomIn className="w-3 h-3" /> Click image to enlarge
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                {currentQuestion.images.map((imgSrc, imgIdx) => (
                  <div
                    key={imgIdx}
                    onClick={() => setZoomedImage(imgSrc)}
                    className="group relative cursor-pointer overflow-hidden rounded-lg hover:ring-2 hover:ring-blue-500 transition"
                  >
                    <img
                      src={imgSrc}
                      alt={`Q${currentQuestion.questionNumber} Diagram ${imgIdx + 1}`}
                      className="max-h-48 sm:max-h-60 object-contain transition-transform duration-200 group-hover:scale-105"
                      loading="eager"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ----------------- ANSWER CONTROLS ----------------- */}
          <div className="pt-4 border-t border-slate-200">
            {isCurrentExpired && (
              <div className="mb-4 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <Lock className="w-4 h-4 text-rose-500" />
                <span>Timer for this question expired. Inputs are locked.</span>
              </div>
            )}

            {/* 1. TASK 2: Two-Part Letter Series (Question 13) */}
            {currentQuestion.type === 'two_part_letter' && (
              <div className="space-y-3 max-w-md">
                <p className="text-xs text-slate-700 font-semibold">
                  Enter both letter groups in order:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      Part 1 (e.g. JHG):
                    </label>
                    <input
                      type="text"
                      disabled={isCurrentExpired}
                      value={currentAnswer.twoPartAnswer?.[0] || ''}
                      onChange={(e) => handleTwoPartChange(0, e.target.value)}
                      placeholder="First Set"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm uppercase focus:border-blue-600 focus:bg-white outline-none disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      Part 2 (e.g. FDC):
                    </label>
                    <input
                      type="text"
                      disabled={isCurrentExpired}
                      value={currentAnswer.twoPartAnswer?.[1] || ''}
                      onChange={(e) => handleTwoPartChange(1, e.target.value)}
                      placeholder="Second Set"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm uppercase focus:border-blue-600 focus:bg-white outline-none disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 2. TASK 2: Two-Part Numerical Series (Question 45) */}
            {currentQuestion.type === 'two_part_number' && (
              <div className="space-y-3 max-w-md">
                <p className="text-xs text-slate-700 font-semibold">
                  Enter both numbers in order:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      First Number (e.g. 8):
                    </label>
                    <input
                      type="text"
                      disabled={isCurrentExpired}
                      value={currentAnswer.twoPartAnswer?.[0] || ''}
                      onChange={(e) => handleTwoPartChange(0, e.target.value)}
                      placeholder="First Number"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm focus:border-blue-600 focus:bg-white outline-none disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 block mb-1">
                      Second Number (e.g. 13):
                    </label>
                    <input
                      type="text"
                      disabled={isCurrentExpired}
                      value={currentAnswer.twoPartAnswer?.[1] || ''}
                      onChange={(e) => handleTwoPartChange(1, e.target.value)}
                      placeholder="Second Number"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm focus:border-blue-600 focus:bg-white outline-none disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3. TASK 4: Numerical Missing Digit (Q20 and Q23) */}
            {currentQuestion.type === 'numerical' && (
              <div className="space-y-3 max-w-xs">
                <label className="text-xs font-semibold text-slate-700 block">
                  Enter the single missing digit that fills the box:
                </label>
                <input
                  type="text"
                  maxLength={2}
                  disabled={isCurrentExpired}
                  value={typeof currentAnswer.selectedOption === 'string' ? currentAnswer.selectedOption : ''}
                  onChange={(e) => handleTextChange(e.target.value.replace(/\D/g, ''))}
                  placeholder="Box digit"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-lg text-center tracking-widest focus:border-emerald-600 focus:bg-white outline-none disabled:opacity-50"
                />
              </div>
            )}

            {/* 4. TASK 3: Multi-Dropdown Sentence Completion (Q18) */}
            {currentQuestion.type === 'multi_dropdown' && currentQuestion.dropdownGroups && (
              <div className="space-y-3">
                <p className="text-xs text-slate-700 font-semibold">
                  Select one word from each bracket line:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {currentQuestion.dropdownGroups.map((grp, gIdx) => {
                    const selectedId = currentAnswer.dropdownSelection?.[gIdx] || '';
                    return (
                      <div key={gIdx} className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-500">
                          Line {gIdx + 1} Selection:
                        </label>
                        <select
                          disabled={isCurrentExpired}
                          value={selectedId}
                          onChange={(e) => handleDropdownSelect(gIdx, e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-medium focus:border-blue-600 focus:bg-white outline-none disabled:opacity-50 cursor-pointer"
                        >
                          <option value="">-- Choose Word --</option>
                          {grp.options.map((op) => (
                            <option key={op.id} value={op.id}>
                              ({op.id}) {op.text}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 5. Boolean (Yes / No) */}
            {currentQuestion.type === 'boolean' && (
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                {['Yes', 'No'].map((val) => {
                  const isSelected = currentAnswer.selectedOption === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      disabled={isCurrentExpired}
                      onClick={() => handleSelectOption(val)}
                      className={`p-4 rounded-xl border-2 text-base font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 ${
                        isSelected
                          ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="w-5 h-5 rounded-full border flex items-center justify-center text-xs">
                        {isSelected ? '✓' : ''}
                      </span>
                      <span>{val}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 6. Multiple Choice (Class A Figures) */}
            {currentQuestion.type === 'multiple_choice' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-700 font-medium">
                  Select both correct figures from the choices below:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { id: '1', text: 'Figure 1' },
                    { id: '2', text: 'Figure 2' },
                    { id: '3', text: 'Figure 3' },
                    { id: '4', text: 'Figure 4' },
                  ].map((opt) => {
                    const selectedList: string[] = Array.isArray(currentAnswer.selectedOption)
                      ? currentAnswer.selectedOption
                      : currentAnswer.selectedOption
                      ? [String(currentAnswer.selectedOption)]
                      : [];
                    const isChecked = selectedList.includes(opt.id);

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isCurrentExpired}
                        onClick={() => handleToggleMultiChoice(opt.id)}
                        className={`p-3.5 rounded-xl border-2 text-xs font-semibold flex items-center gap-2.5 transition cursor-pointer disabled:opacity-50 ${
                          isChecked
                            ? 'bg-indigo-50 border-indigo-600 text-indigo-700 shadow-sm'
                            : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${
                            isChecked
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300'
                          }`}
                        >
                          {isChecked ? '✓' : ''}
                        </div>
                        <span>{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 7. Single Choice (Standard Options) */}
            {currentQuestion.type === 'single_choice' && currentQuestion.options && currentQuestion.options.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {currentQuestion.options.map((opt) => {
                  const isSelected = currentAnswer.selectedOption === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isCurrentExpired}
                      onClick={() => handleSelectOption(opt.id)}
                      className={`p-3.5 rounded-xl border-2 text-left flex items-center gap-3 transition cursor-pointer disabled:opacity-50 ${
                        isSelected
                          ? 'bg-blue-50 border-blue-600 text-blue-800 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-lg font-mono text-xs font-bold flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {opt.id}
                      </span>
                      <span className="text-xs sm:text-sm font-medium">{opt.text}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 8. Text Input */}
            {currentQuestion.type === 'text' && (
              <div className="space-y-3 max-w-lg">
                <label className="block text-xs font-semibold text-slate-700">
                  Enter your response (letter, number, or word):
                </label>
                <input
                  type="text"
                  disabled={isCurrentExpired}
                  value={typeof currentAnswer.selectedOption === 'string' ? currentAnswer.selectedOption : ''}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder="Type answer here..."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white text-slate-900 text-sm outline-none font-medium disabled:opacity-50"
                />
              </div>
            )}
          </div>
        </div>

        {/* ----------------- BOTTOM BAR ACTIONS ----------------- */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
          {/* Previous Button */}
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
              currentIndex === 0
                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-sm'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          {/* Quick Question Jump on desktop */}
          <div className="hidden md:flex items-center gap-1 overflow-x-auto max-w-md py-1">
            {questions.map((q, idx) => {
              const isCur = idx === currentIndex;
              const isAns = userAnswers[q.questionNumber]?.isAnswered;
              const isExp = questionExpiredMap[q.questionNumber];
              return (
                <button
                  key={q.questionNumber}
                  type="button"
                  onClick={() => switchQuestion(idx)}
                  className={`w-6 h-6 rounded text-[10px] font-mono font-bold flex items-center justify-center transition cursor-pointer ${
                    isCur
                      ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                      : isAns
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold'
                      : isExp
                      ? 'bg-rose-50 text-rose-500 border border-rose-200'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                  title={`Question ${q.questionNumber}${isExp ? ' (Expired)' : ''}`}
                >
                  {q.questionNumber}
                </button>
              );
            })}
          </div>

          {/* Skip & Next */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSkip}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 text-xs font-medium transition cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5 text-slate-400" />
              <span>Skip</span>
            </button>

            {currentIndex < totalQuestions - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm shadow-blue-600/30 transition cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm shadow-emerald-600/30 transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit Exam</span>
              </button>
            )}
          </div>
        </div>
      </main>

      {/* ----------------- IMAGE ZOOM MODAL ----------------- */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md cursor-zoom-out animate-in fade-in"
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-4 rounded-2xl shadow-2xl overflow-auto border border-slate-200">
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomedImage}
              alt="Enlarged Diagram"
              className="w-full h-auto object-contain mx-auto"
            />
          </div>
        </div>
      )}

      {/* ----------------- SUBMIT CONFIRMATION MODAL ----------------- */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 text-slate-800 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-slate-900">Confirm Test Submission</h3>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to finalize your exam? Once submitted, your score will be computed and solutions revealed.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Questions:</span>
                <span className="text-slate-800 font-bold">{totalQuestions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-700">Answered:</span>
                <span className="text-emerald-800 font-bold">{answeredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-700">Unanswered / Skipped:</span>
                <span className="text-amber-800 font-bold">{totalQuestions - answeredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-blue-700">Time Remaining:</span>
                <span className="text-blue-800 font-bold">{formatTime(overallRemaining)}</span>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200 transition cursor-pointer"
              >
                Keep Practicing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSubmitModal(false);
                  submitExam('manual');
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm shadow-emerald-600/30 transition cursor-pointer"
              >
                Yes, Submit Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- SUBMISSION ERROR MODAL (TASK 1) ----------------- */}
      {submissionError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white border-2 border-rose-300 rounded-2xl p-6 text-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-slate-900">Submission Storage Issue</h3>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed font-medium">
              {submissionError}
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Practice Set:</span>
                <span className="text-slate-800 font-bold">SET {setNumber.toString().padStart(2, '0')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-700">Answered Questions:</span>
                <span className="text-emerald-800 font-bold">{answeredCount} of {totalQuestions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">State:</span>
                <span className="text-blue-700 font-bold">Preserved in Active Storage</span>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              {overallRemaining > 0 && (
                <button
                  type="button"
                  onClick={() => setSubmissionError(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs border border-slate-200 transition cursor-pointer"
                >
                  Return to Test
                </button>
              )}
              <button
                type="button"
                disabled={isSaving}
                onClick={() => submitExam('manual')}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm shadow-blue-600/30 transition cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'Retrying...' : 'Retry Saving'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
