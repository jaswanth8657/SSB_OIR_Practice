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
  });

  // 4. Expired Exam Recovery (Task 3)
  describe('checkAndRecoverExpiredExam (Task 3)', () => {
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

    it('recovers expired exam, grades saved responses, and persists completed attempt', () => {
      const now = Date.now();
      const activeState: ActiveExamState = {
        setNumber: 1,
        currentQuestionIndex: 15,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: '1', isAnswered: true },
          2: { questionNumber: 2, selectedOption: '2', isAnswered: true },
        },
        examStartTime: now - 30 * 60 * 1000,
        examEndTime: now - 5 * 60 * 1000, // expired 5 minutes ago
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 5 * 60 * 1000,
        questionExpiredMap: {},
      };

      saveActiveExam(activeState);
      expect(getActiveExam(1)).not.toBeNull();

      const recovered = checkAndRecoverExpiredExam(1, mockQuestions, DEFAULT_SETTINGS);
      expect(recovered).not.toBeNull();
      expect(recovered?.setNumber).toBe(1);
      expect(recovered?.score).toBe(1); // Q1 correct, Q2 incorrect
      expect(recovered?.correctAnswers).toBe(1);
      expect(recovered?.incorrectAnswers).toBe(1);
      expect(recovered?.unansweredQuestions).toBe(48);

      // Verify it was safely saved to attempts
      expect(getAllAttempts().length).toBe(1);

      // Verify active exam was cleared
      expect(getActiveExam(1)).toBeNull();

      // Repeated recovery must NOT duplicate attempt in history
      const repeated = checkAndRecoverExpiredExam(1, mockQuestions, DEFAULT_SETTINGS);
      // It returns the existing attempt or null without duplicating
      expect(getAllAttempts().length).toBe(1);
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
