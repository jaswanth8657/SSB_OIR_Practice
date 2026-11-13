import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getUserSettings,
  saveUserSettings,
  resetUserSettings,
  saveAttempt,
  getAllAttempts,
  getAttemptsForSet,
  getSetProgress,
  getOverallStats,
  getActiveExam,
  saveActiveExam,
  clearActiveExam,
  checkAndRecoverExpiredExam,
  DEFAULT_SETTINGS,
} from '../src/utils/storage';
import { Question, ActiveExamState } from '../src/types/oir';

describe('Production Storage & Recovery Engine (src/utils/storage.ts)', () => {
  // In-memory localStorage mock
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 1. Settings persistence
  it('reads default settings and saves customized settings', () => {
    expect(getUserSettings()).toEqual(DEFAULT_SETTINGS);

    saveUserSettings({ questionTimeSeconds: 50, totalDurationMinutes: 30 });
    const updated = getUserSettings();
    expect(updated.questionTimeSeconds).toBe(50);
    expect(updated.totalDurationMinutes).toBe(30);

    resetUserSettings();
    expect(getUserSettings()).toEqual(DEFAULT_SETTINGS);
  });

  // 2. Attempt history & duplicate protection
  it('saves attempts and prevents duplicate attempt IDs', () => {
    const att1 = {
      attemptId: 'att_1_1000',
      setNumber: 1,
      timestamp: 1000,
      totalQuestions: 50,
      maxScore: 50,
      score: 45,
      correctAnswers: 45,
      incorrectAnswers: 3,
      unansweredQuestions: 2,
      excludedQuestions: 0,
      accuracyPercentage: 94,
      timeTakenSeconds: 1200,
      userAnswers: {},
    };

    saveAttempt(att1);
    expect(getAllAttempts().length).toBe(1);

    // Saving identical attemptId must be safely ignored
    saveAttempt(att1);
    expect(getAllAttempts().length).toBe(1);

    // Saving another attempt on same set
    const att2 = { ...att1, attemptId: 'att_1_2000', timestamp: 2000, score: 48 };
    saveAttempt(att2);
    expect(getAllAttempts().length).toBe(2);
    expect(getAttemptsForSet(1).length).toBe(2);
  });

  // 3. Progress and Retakes
  it('marks set as completed with best score preserved across retakes', () => {
    expect(getSetProgress(1).status).toBe('not_started');

    const att1 = {
      attemptId: 'att_1_1',
      setNumber: 1,
      timestamp: 1000,
      totalQuestions: 50,
      maxScore: 50,
      score: 35,
      correctAnswers: 35,
      incorrectAnswers: 5,
      unansweredQuestions: 10,
      excludedQuestions: 0,
      accuracyPercentage: 88,
      timeTakenSeconds: 1200,
      userAnswers: {},
    };
    saveAttempt(att1);

    const prog1 = getSetProgress(1);
    expect(prog1.status).toBe('completed');
    expect(prog1.bestScore).toBe(35);
    expect(prog1.attemptsCount).toBe(1);

    // Retake with higher score
    const att2 = { ...att1, attemptId: 'att_1_2', score: 45, correctAnswers: 45 };
    saveAttempt(att2);

    const prog2 = getSetProgress(1);
    expect(prog2.status).toBe('completed');
    expect(prog2.bestScore).toBe(45);
    expect(prog2.attemptsCount).toBe(2);

    // TASK 5: Retake in progress: must report 'in_progress' while preserving bestScore & attemptCount!
    const now = Date.now();
    saveActiveExam({
      setNumber: 1,
      currentQuestionIndex: 10,
      userAnswers: {},
      examStartTime: now,
      examEndTime: now + 25 * 60 * 1000,
      questionTimeLeft: {},
      currentQuestionStartedAt: now,
      questionExpiredMap: {},
    });

    const progDuringRetake = getSetProgress(1);
    expect(progDuringRetake.status).toBe('in_progress');
    expect(progDuringRetake.attemptsCount).toBe(2);
    expect(progDuringRetake.bestScore).toBe(45);

    // After retake completes / active exam cleared: returns to 'completed'
    clearActiveExam(1);
    const progAfterRetake = getSetProgress(1);
    expect(progAfterRetake.status).toBe('completed');
    expect(progAfterRetake.bestScore).toBe(45);
  });

  // 4. Legacy Attempt Normalization (Task 4)
  describe('Legacy attempt normalization (Task 4)', () => {
    it('normalizes legacy Set 06 attempt with Q11 excluded and maxScore 49', () => {
      // Legacy Set 06 attempt without maxScore / excludedQuestions
      const legacySet06 = {
        attemptId: 'att_6_legacy',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        score: 40,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, selectedOption: 'N', isAnswered: true, isCorrect: true },
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true },
        },
      };

      store['oir_test_attempts_v1'] = JSON.stringify([legacySet06]);

      const loaded = getAllAttempts();
      expect(loaded.length).toBe(1);
      const normalized = loaded[0];

      // Q11 was excluded: score adjusted from 40 to 39
      expect(normalized.maxScore).toBe(49);
      expect(normalized.excludedQuestions).toBe(1);
      expect(normalized.score).toBe(39);
      expect(normalized.correctAnswers).toBe(39);
      expect(normalized.userAnswers[11].isExcluded).toBe(true);

      // Invariant: correct + incorrect + unanswered + excluded === totalQuestions
      expect(
        normalized.correctAnswers +
        normalized.incorrectAnswers +
        normalized.unansweredQuestions +
        normalized.excludedQuestions
      ).toBe(50);
    });
  });

  // 5. Expired Exam Recovery (Task 2 & Task 3)
  describe('checkAndRecoverExpiredExam (Task 2 & Task 3)', () => {
    const mockQuestions: Question[] = [];
    for (let i = 1; i <= 50; i++) {
      mockQuestions.push({
        id: i,
        setNumber: 1,
        questionNumber: i,
        statement: `Question ${i}`,
        type: 'single_choice',
        images: [],
        options: [{ id: '1', text: 'Option 1' }],
        correctAnswer: '(1)',
        explanation: '',
      });
    }

    it('recovers expired exam preserving original exam deadline as attempt timestamp (Task 3)', () => {
      const now = Date.now();
      const originalExpirationTime = now - 15 * 60 * 1000; // expired 15 minutes ago
      const activeState: ActiveExamState = {
        setNumber: 1,
        currentQuestionIndex: 15,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: '1', isAnswered: true },
          2: { questionNumber: 2, selectedOption: '2', isAnswered: true },
        },
        examStartTime: originalExpirationTime - 25 * 60 * 1000,
        examEndTime: originalExpirationTime,
        questionTimeLeft: {},
        currentQuestionStartedAt: originalExpirationTime,
        questionExpiredMap: {},
      };

      saveActiveExam(activeState);
      expect(getActiveExam(1)).not.toBeNull();

      const recovered = checkAndRecoverExpiredExam(1, mockQuestions, DEFAULT_SETTINGS);
      expect(recovered).not.toBeNull();
      expect(recovered?.setNumber).toBe(1);
      // TASK 3 VERIFICATION: Timestamp must be original examEndTime, NOT Date.now()!
      expect(recovered?.timestamp).toBe(originalExpirationTime);
      expect(recovered?.score).toBe(1); // Q1 correct, Q2 incorrect
      expect(recovered?.correctAnswers).toBe(1);
      expect(recovered?.incorrectAnswers).toBe(1);
      expect(recovered?.unansweredQuestions).toBe(48);

      // Verify it was safely saved to attempts
      expect(getAllAttempts().length).toBe(1);

      // Verify active exam was cleared after successful save
      expect(getActiveExam(1)).toBeNull();

      // Repeated recovery must NOT duplicate attempt in history
      const repeated = checkAndRecoverExpiredExam(1, mockQuestions, DEFAULT_SETTINGS);
      expect(getAllAttempts().length).toBe(1);
    });

    it('prevents duplicate attempts when two tabs recover simultaneously (Multi-Tab Protection Task 2)', () => {
      const now = Date.now();
      const activeState: ActiveExamState = {
        setNumber: 3,
        currentQuestionIndex: 20,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: '1', isAnswered: true },
        },
        examStartTime: now - 30 * 60 * 1000,
        examEndTime: now - 5 * 60 * 1000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 5 * 60 * 1000,
        questionExpiredMap: {},
      };

      saveActiveExam(activeState);

      // Tab 1 recovers
      const recTab1 = checkAndRecoverExpiredExam(3, mockQuestions, DEFAULT_SETTINGS);
      expect(recTab1).not.toBeNull();

      // Tab 2 attempts recovery of the exact same exam
      const recTab2 = checkAndRecoverExpiredExam(3, mockQuestions, DEFAULT_SETTINGS);
      expect(recTab2).not.toBeNull();
      expect(recTab2?.attemptId).toBe(recTab1?.attemptId);

      // Verify exactly ONE attempt exists in history
      const set3Attempts = getAttemptsForSet(3);
      expect(set3Attempts.length).toBe(1);
    });

    it('RETAINS active examination if storage write fails (Never silently discard Task 2)', () => {
      const now = Date.now();
      const activeState: ActiveExamState = {
        setNumber: 4,
        currentQuestionIndex: 5,
        userAnswers: {},
        examStartTime: now - 30 * 60 * 1000,
        examEndTime: now - 2 * 60 * 1000, // expired
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 2 * 60 * 1000,
        questionExpiredMap: {},
      };

      saveActiveExam(activeState);

      // Simulate localStorage failure when saving attempts
      const originalSetItem = localStorage.setItem;
      vi.stubGlobal('localStorage', {
        ...localStorage,
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => {
          if (k === 'oir_test_attempts_v1') {
            throw new Error('QuotaExceededError: storage full');
          }
          store[k] = v;
        },
      });

      // Recovery should fail safely
      const recovered = checkAndRecoverExpiredExam(4, mockQuestions, DEFAULT_SETTINGS);
      expect(recovered).toBeNull();

      // CRITICAL REQUIREMENT: Active exam MUST NOT be deleted if saving failed!
      expect(getActiveExam(4)).not.toBeNull();
    });

    it('returns null if exam is still in progress (not expired yet)', () => {
      const now = Date.now();
      const activeState: ActiveExamState = {
        setNumber: 2,
        currentQuestionIndex: 5,
        userAnswers: {},
        examStartTime: now,
        examEndTime: now + 20 * 60 * 1000, // 20 mins remaining
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
      };

      saveActiveExam(activeState);
      const recovered = checkAndRecoverExpiredExam(2, mockQuestions, DEFAULT_SETTINGS);
      expect(recovered).toBeNull();
      expect(getActiveExam(2)).not.toBeNull(); // Still active
    });
  });
});
