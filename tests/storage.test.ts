import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
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
  normalizeLegacyAttempt,
  acquireIdbLease,
  releaseIdbLease,
  DEFAULT_SETTINGS,
} from '../src/utils/storage';
import { Question, ActiveExamState, TestAttempt } from '../src/types/oir';

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
    const att1: TestAttempt = {
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

    const att1: TestAttempt = {
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
      timeTakenSeconds: 1100,
      userAnswers: {},
    };

    saveAttempt(att1);
    const progressAfterAttempt1 = getSetProgress(1);
    expect(progressAfterAttempt1.status).toBe('completed');
    expect(progressAfterAttempt1.attemptsCount).toBe(1);
    expect(progressAfterAttempt1.bestScore).toBe(35);

    // Retake attempt 2 with higher score
    const att2: TestAttempt = {
      ...att1,
      attemptId: 'att_1_2',
      timestamp: 2000,
      score: 44,
      correctAnswers: 44,
    };
    saveAttempt(att2);

    const progressAfterAttempt2 = getSetProgress(1);
    expect(progressAfterAttempt2.attemptsCount).toBe(2);
    expect(progressAfterAttempt2.bestScore).toBe(44);

    // Retake attempt 3 with lower score: bestScore must remain 44
    const att3: TestAttempt = {
      ...att1,
      attemptId: 'att_1_3',
      timestamp: 3000,
      score: 40,
      correctAnswers: 40,
    };
    saveAttempt(att3);

    const progressAfterAttempt3 = getSetProgress(1);
    expect(progressAfterAttempt3.attemptsCount).toBe(3);
    expect(progressAfterAttempt3.bestScore).toBe(44);
  });

  // 4. In-progress retake status prioritization
  it('prioritizes in_progress status during retake while preserving historical completed attempts', () => {
    const att1: TestAttempt = {
      attemptId: 'att_1_1',
      setNumber: 1,
      timestamp: 1000,
      totalQuestions: 50,
      maxScore: 50,
      score: 42,
      correctAnswers: 42,
      incorrectAnswers: 8,
      unansweredQuestions: 0,
      excludedQuestions: 0,
      accuracyPercentage: 84,
      timeTakenSeconds: 1000,
      userAnswers: {},
    };
    saveAttempt(att1);

    expect(getSetProgress(1).status).toBe('completed');
    expect(getSetProgress(1).attemptsCount).toBe(1);
    expect(getSetProgress(1).bestScore).toBe(42);

    // Now start a retake: active examination exists in progress
    const activeRetakeState: ActiveExamState = {
      setNumber: 1,
      currentQuestionIndex: 10,
      userAnswers: {},
      examStartTime: Date.now(),
      examEndTime: Date.now() + 25 * 60 * 1000,
      questionTimeLeft: {},
      currentQuestionStartedAt: Date.now(),
      questionExpiredMap: {},
    };
    saveActiveExam(activeRetakeState);

    // During retake, status MUST report 'in_progress' to show Resume button,
    // but MUST preserve attempt history, attemptsCount, bestScore, and lastAttemptTimestamp
    const progressDuringRetake = getSetProgress(1);
    expect(progressDuringRetake.status).toBe('in_progress');
    expect(progressDuringRetake.attemptsCount).toBe(1);
    expect(progressDuringRetake.bestScore).toBe(42);
    expect(progressDuringRetake.lastAttemptTimestamp).toBe(1000);

    // Clean up active exam
    clearActiveExam(1);
    expect(getSetProgress(1).status).toBe('completed');
  });

  // 5. Evidence-based Legacy Normalization (Task 3)
  describe('normalizeLegacyAttempt (Task 3: Evidence-Based Normalization)', () => {
    it('Case A1: Normalizes legacy Set 06 attempt where Q11 was previously marked correct', () => {
      const legacySet06: TestAttempt = {
        attemptId: 'att_6_legacy_correct',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 40,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, selectedOption: 'N', isAnswered: true, isCorrect: true },
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(legacySet06);

      // Q11 was credited: correct answer count and score adjusted from 40 to 39
      expect(normalized.maxScore).toBe(49);
      expect(normalized.excludedQuestions).toBe(1);
      expect(normalized.score).toBe(39);
      expect(normalized.correctAnswers).toBe(39);
      expect(normalized.incorrectAnswers).toBe(8);
      expect(normalized.unansweredQuestions).toBe(2);
      expect(normalized.userAnswers[11].isExcluded).toBe(true);
      expect(normalized.legacyStatus).toBe('verified');
      expect(normalized.isLegacyUnverified).toBe(false);

      // Scoring invariant: correct + incorrect + unanswered + excluded === 50
      expect(
        normalized.correctAnswers +
        normalized.incorrectAnswers +
        normalized.unansweredQuestions +
        normalized.excludedQuestions
      ).toBe(50);
    });

    it('Case A2: Normalizes legacy Set 06 attempt where Q11 was previously marked incorrect', () => {
      const legacySet06: TestAttempt = {
        attemptId: 'att_6_legacy_incorrect',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 40,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, selectedOption: 'Z', isAnswered: true, isCorrect: false },
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(legacySet06);

      // Q11 was incorrect: score remains 40, incorrect count adjusted from 8 to 7
      expect(normalized.maxScore).toBe(49);
      expect(normalized.excludedQuestions).toBe(1);
      expect(normalized.score).toBe(40);
      expect(normalized.correctAnswers).toBe(40);
      expect(normalized.incorrectAnswers).toBe(7);
      expect(normalized.unansweredQuestions).toBe(2);
      expect(normalized.userAnswers[11].isExcluded).toBe(true);
      expect(normalized.legacyStatus).toBe('verified');

      // Scoring invariant: 40 + 7 + 2 + 1 = 50
      expect(
        normalized.correctAnswers +
        normalized.incorrectAnswers +
        normalized.unansweredQuestions +
        normalized.excludedQuestions
      ).toBe(50);
    });

    it('Case A3: Normalizes legacy Set 06 attempt where Q11 was unanswered', () => {
      const legacySet06: TestAttempt = {
        attemptId: 'att_6_legacy_unanswered',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 40,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: false, isCorrect: false },
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(legacySet06);

      // Q11 was unanswered: score remains 40, unanswered count adjusted from 2 to 1
      expect(normalized.maxScore).toBe(49);
      expect(normalized.excludedQuestions).toBe(1);
      expect(normalized.score).toBe(40);
      expect(normalized.correctAnswers).toBe(40);
      expect(normalized.incorrectAnswers).toBe(8);
      expect(normalized.unansweredQuestions).toBe(1);
      expect(normalized.userAnswers[11].isExcluded).toBe(true);
      expect(normalized.legacyStatus).toBe('verified');

      // Scoring invariant: 40 + 8 + 1 + 1 = 50
      expect(
        normalized.correctAnswers +
        normalized.incorrectAnswers +
        normalized.unansweredQuestions +
        normalized.excludedQuestions
      ).toBe(50);
    });

    it('Case B: NEVER guesses when Q11 record is missing or incomplete: preserves recorded score and flags review_required', () => {
      const legacySet06MissingQ11: TestAttempt = {
        attemptId: 'att_6_legacy_missing_q11',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 40,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          // Q11 is completely missing from userAnswers
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(legacySet06MissingQ11);

      // CRITICAL REQUIREMENT: Score MUST NOT be altered based on a guess!
      expect(normalized.score).toBe(40);
      expect(normalized.correctAnswers).toBe(40);
      expect(normalized.incorrectAnswers).toBe(8);
      expect(normalized.unansweredQuestions).toBe(2);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
      expect(normalized.legacyNote).toContain('Question 11 response could not be verified');
    });

    it('Case C: Leaves already-normalized attempts completely unchanged on repeated loads', () => {
      const alreadyNormalized: TestAttempt = {
        attemptId: 'att_6_already_normalized',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 49,
        excludedQuestions: 1,
        score: 39,
        correctAnswers: 39,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: false, isExcluded: true },
        },
        legacyStatus: 'verified',
      };

      const pass1 = normalizeLegacyAttempt(alreadyNormalized);
      expect(pass1.score).toBe(39);
      expect(pass1.maxScore).toBe(49);

      const pass2 = normalizeLegacyAttempt(pass1);
      expect(pass2.score).toBe(39);
      expect(pass2.maxScore).toBe(49);
    });

    it('Case D: Leaves non-Set 06 attempts compatible without deduction', () => {
      const set01Attempt: TestAttempt = {
        attemptId: 'att_1_normal',
        setNumber: 1,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        excludedQuestions: 0,
        score: 45,
        correctAnswers: 45,
        incorrectAnswers: 3,
        unansweredQuestions: 2,
        accuracyPercentage: 94,
        timeTakenSeconds: 1000,
        userAnswers: {},
      };

      const normalized = normalizeLegacyAttempt(set01Attempt);
      expect(normalized.score).toBe(45);
      expect(normalized.maxScore).toBe(50);
      expect(normalized.excludedQuestions).toBe(0);
    });
  });

  // 6. Cross-Tab Recovery Locking & Concurrency (Task 2 & Task 4)
  describe('checkAndRecoverExpiredExam (Task 2 & Task 4: Coordination & Failure States)', () => {
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

    it('recovers expired exam preserving original exam deadline as attempt timestamp', async () => {
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

      const res = await checkAndRecoverExpiredExam(1, mockQuestions, DEFAULT_SETTINGS);
      expect(res.status).toBe('recovered');
      if (res.status === 'recovered') {
        expect(res.attempt.setNumber).toBe(1);
        expect(res.attempt.timestamp).toBe(originalExpirationTime);
        expect(res.attempt.score).toBe(1);
        expect(res.attempt.correctAnswers).toBe(1);
        expect(res.attempt.incorrectAnswers).toBe(1);
        expect(res.attempt.unansweredQuestions).toBe(48);
      }

      // Verify it was safely saved to attempts
      expect(getAllAttempts().length).toBe(1);

      // Verify active exam was cleared after successful save
      expect(getActiveExam(1)).toBeNull();

      // Repeated recovery must return already_recovered and NOT duplicate attempt in history
      const repeated = await checkAndRecoverExpiredExam(1, mockQuestions, DEFAULT_SETTINGS);
      expect(repeated.status).toBe('already_recovered');
      expect(getAllAttempts().length).toBe(1);
    });

    it('prevents race conditions and duplicates under genuine concurrent recovery requests (Task 2)', async () => {
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

      // Genuinely simulate two concurrent tabs calling recovery at the same time
      const [res1, res2] = await Promise.all([
        checkAndRecoverExpiredExam(3, mockQuestions, DEFAULT_SETTINGS),
        checkAndRecoverExpiredExam(3, mockQuestions, DEFAULT_SETTINGS),
      ]);

      const validStatuses = ['recovered', 'already_recovered'];
      expect(validStatuses).toContain(res1.status);
      expect(validStatuses).toContain(res2.status);

      // Exactly ONE attempt must exist in permanent history
      const set3Attempts = getAttemptsForSet(3);
      expect(set3Attempts.length).toBe(1);
      expect(getActiveExam(3)).toBeNull();
    });

    it('recovers independent examination sets simultaneously without cross-blocking', async () => {
      const now = Date.now();
      const stateSet5: ActiveExamState = {
        setNumber: 5,
        currentQuestionIndex: 5,
        userAnswers: { 1: { questionNumber: 1, selectedOption: '1', isAnswered: true } },
        examStartTime: now - 30 * 60 * 1000,
        examEndTime: now - 2 * 60 * 1000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 2 * 60 * 1000,
        questionExpiredMap: {},
      };
      const stateSet7: ActiveExamState = {
        setNumber: 7,
        currentQuestionIndex: 5,
        userAnswers: { 1: { questionNumber: 1, selectedOption: '1', isAnswered: true } },
        examStartTime: now - 30 * 60 * 1000,
        examEndTime: now - 2 * 60 * 1000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 2 * 60 * 1000,
        questionExpiredMap: {},
      };

      saveActiveExam(stateSet5);
      saveActiveExam(stateSet7);

      const [resSet5, resSet7] = await Promise.all([
        checkAndRecoverExpiredExam(5, mockQuestions, DEFAULT_SETTINGS),
        checkAndRecoverExpiredExam(7, mockQuestions, DEFAULT_SETTINGS),
      ]);

      expect(resSet5.status).toBe('recovered');
      expect(resSet7.status).toBe('recovered');
      expect(getAttemptsForSet(5).length).toBe(1);
      expect(getAttemptsForSet(7).length).toBe(1);
    });

    it('RETAINS active examination and returns storage_error if storage write fails (Task 2 & Task 4)', async () => {
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

      // Recovery should return structured storage_error
      const res = await checkAndRecoverExpiredExam(4, mockQuestions, DEFAULT_SETTINGS);
      expect(res.status).toBe('storage_error');
      if (res.status === 'storage_error') {
        expect(res.setNumber).toBe(4);
        expect(res.message).toContain('QuotaExceededError');
      }

      // CRITICAL: Active exam MUST NOT be deleted if saving failed!
      expect(getActiveExam(4)).not.toBeNull();
    });

    it('returns not_expired if exam is still in progress', async () => {
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
      const res = await checkAndRecoverExpiredExam(2, mockQuestions, DEFAULT_SETTINGS);
      expect(res.status).toBe('not_expired');
      expect(getActiveExam(2)).not.toBeNull();
    });

    it('IndexedDB fallback lease acquisition, lease verification, and release work cleanly', async () => {
      const owner1 = 'owner_tab_1';
      const owner2 = 'owner_tab_2';

      // Tab 1 acquires lease for Set 9
      const acq1 = await acquireIdbLease(9, owner1, 5000);
      expect(acq1).toBe(true);

      // Tab 2 cannot acquire actively held lease
      const acq2 = await acquireIdbLease(9, owner2, 5000);
      expect(acq2).toBe(false);

      // Tab 1 releases lease
      await releaseIdbLease(9, owner1);

      // Tab 2 can now acquire lease
      const acq2Retry = await acquireIdbLease(9, owner2, 5000);
      expect(acq2Retry).toBe(true);
      await releaseIdbLease(9, owner2);
    });

    it('reclaims stale expired IndexedDB lease safely', async () => {
      const staleOwner = 'owner_stale';
      const newOwner = 'owner_new';

      // Acquire with expired TTL (0ms)
      await acquireIdbLease(12, staleOwner, -100);

      // New owner should immediately be able to reclaim expired lease
      const reclaimed = await acquireIdbLease(12, newOwner, 5000);
      expect(reclaimed).toBe(true);
      await releaseIdbLease(12, newOwner);
    });
  });
});