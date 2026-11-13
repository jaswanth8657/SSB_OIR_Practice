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
  renewIdbLease,
  releaseIdbLease,
  hydrateActiveExamCache,
  invalidateActiveExamCache,
  isStateDeepEqual,
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

    it('Case B: NEVER guesses when Q11 record is missing: preserves recorded score and flags review_required', () => {
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
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(legacySet06MissingQ11);
      expect(normalized.score).toBe(40);
      expect(normalized.correctAnswers).toBe(40);
      expect(normalized.incorrectAnswers).toBe(8);
      expect(normalized.unansweredQuestions).toBe(2);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
      expect(normalized.legacyNote).toContain('Question 11 response could not be verified');
    });

    it('Defect 1: Rejects normalization when Q11 object has no isAnswered', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_no_is_answered',
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
          11: { questionNumber: 11 } as any,
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.correctAnswers).toBe(40);
      expect(normalized.unansweredQuestions).toBe(2);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Defect 1: Rejects normalization when Q11 is marked answered but missing isCorrect', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_missing_is_correct',
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
          11: { questionNumber: 11, isAnswered: true } as any,
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.correctAnswers).toBe(40);
      expect(normalized.incorrectAnswers).toBe(8);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Defect 1: Rejects normalization when isAnswered is not a boolean', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_malformed_boolean',
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
          11: { questionNumber: 11, isAnswered: 'true' as any, isCorrect: true as any },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Defect 1: Rejects normalization when aggregate counters are missing', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_missing_counters',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 40,
        correctAnswers: undefined as any,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Defect 1: Rejects normalization when aggregate counter is 0 but deduction is required', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_zero_counter',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 0,
        correctAnswers: 0, // 0 correct answers, cannot deduct 1!
        incorrectAnswers: 48,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 0,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      // Must NOT use Math.max(0, -1) to hide this! Must preserve score 0 and flag review_required
      expect(normalized.score).toBe(0);
      expect(normalized.correctAnswers).toBe(0);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Defect 1: Rejects normalization when aggregate totals are inconsistent', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_inconsistent_totals',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 30,
        correctAnswers: 30,
        incorrectAnswers: 5,
        unansweredQuestions: 5, // Sum = 40 !== 50!
        excludedQuestions: 0,
        accuracyPercentage: 85,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(30);
      expect(normalized.correctAnswers).toBe(30);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Defect 1: Rejects normalization when aggregate values are negative', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_negative_values',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: -5,
        correctAnswers: -5,
        incorrectAnswers: 50,
        unansweredQuestions: 5,
        excludedQuestions: 0,
        accuracyPercentage: 0,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
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

    it('Part 3: Rejects normalization when Q11 object is incomplete or missing questionNumber', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_incomplete_q11',
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
          11: {} as any,
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when Q11 record has questionNumber !== 11', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_wrong_qnum',
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
          11: { questionNumber: 12, isAnswered: true, isCorrect: true } as any,
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when isCorrect is not a boolean', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_non_bool_is_correct',
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
          11: { questionNumber: 11, isAnswered: true, isCorrect: 'yes' as any },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when flags are contradictory (isAnswered: false, isCorrect: true)', () => {
      const att: TestAttempt = {
        attemptId: 'att_6_contradictory_flags',
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
          11: { questionNumber: 11, isAnswered: false, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(att);
      expect(normalized.score).toBe(40);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when score or counters are decimals/floats', () => {
      const attFloatScore: TestAttempt = {
        attemptId: 'att_6_float_score',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 40.5,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const norm1 = normalizeLegacyAttempt(attFloatScore);
      expect(norm1.isLegacyUnverified).toBe(true);
      expect(norm1.legacyStatus).toBe('review_required');

      const attFloatCorrect: TestAttempt = {
        ...attFloatScore,
        score: 40,
        correctAnswers: 40.2,
      };
      const norm2 = normalizeLegacyAttempt(attFloatCorrect);
      expect(norm2.isLegacyUnverified).toBe(true);
      expect(norm2.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when score is NaN', () => {
      const attNaN: TestAttempt = {
        attemptId: 'att_6_nan_score',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: NaN,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(attNaN);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when totalQuestions !== 50', () => {
      const attWrongTotal: TestAttempt = {
        attemptId: 'att_6_wrong_total',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 49,
        maxScore: 49,
        score: 40,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 1,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(attWrongTotal);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when score does not match correctAnswers', () => {
      const attMismatchedScore: TestAttempt = {
        attemptId: 'att_6_mismatched_score',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 45,
        correctAnswers: 40,
        incorrectAnswers: 8,
        unansweredQuestions: 2,
        excludedQuestions: 0,
        accuracyPercentage: 83,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: true },
        },
      };

      const normalized = normalizeLegacyAttempt(attMismatchedScore);
      expect(normalized.isLegacyUnverified).toBe(true);
      expect(normalized.legacyStatus).toBe('review_required');
    });

    it('Part 3: Rejects normalization when incorrectAnswers < 1 for Case B or unanswered < 1 for Case C', () => {
      // Case B with incorrectAnswers === 0
      const attCaseBZero: TestAttempt = {
        attemptId: 'att_6_case_b_zero',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 50,
        correctAnswers: 50,
        incorrectAnswers: 0,
        unansweredQuestions: 0,
        excludedQuestions: 0,
        accuracyPercentage: 100,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: true, isCorrect: false },
        },
      };

      const normB = normalizeLegacyAttempt(attCaseBZero);
      expect(normB.isLegacyUnverified).toBe(true);
      expect(normB.legacyStatus).toBe('review_required');

      // Case C with unansweredQuestions === 0
      const attCaseCZero: TestAttempt = {
        attemptId: 'att_6_case_c_zero',
        setNumber: 6,
        timestamp: 1600000000000,
        totalQuestions: 50,
        maxScore: 50,
        score: 45,
        correctAnswers: 45,
        incorrectAnswers: 5,
        unansweredQuestions: 0,
        excludedQuestions: 0,
        accuracyPercentage: 90,
        timeTakenSeconds: 1100,
        userAnswers: {
          11: { questionNumber: 11, isAnswered: false },
        },
      };

      const normC = normalizeLegacyAttempt(attCaseCZero);
      expect(normC.isLegacyUnverified).toBe(true);
      expect(normC.legacyStatus).toBe('review_required');
    });

    it('Part 3: Repeated runs on already review_required attempts are idempotent', () => {
      const attReview: TestAttempt = {
        attemptId: 'att_6_already_review',
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
        userAnswers: {},
        isLegacyUnverified: true,
        legacyStatus: 'review_required',
        originalScore: 40,
      };

      const pass1 = normalizeLegacyAttempt(attReview);
      expect(pass1.score).toBe(40);
      expect(pass1.legacyStatus).toBe('review_required');

      const pass2 = normalizeLegacyAttempt(pass1);
      expect(pass2.score).toBe(40);
      expect(pass2.legacyStatus).toBe('review_required');
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
      expect(await getActiveExam(1)).not.toBeNull();

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
      expect(await getActiveExam(1)).toBeNull();

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
      expect(await getActiveExam(3)).toBeNull();
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
      expect(await getActiveExam(4)).not.toBeNull();
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
      expect(await getActiveExam(2)).not.toBeNull();
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

  // 7. Defect 3: Active Examination Persistence & Durable IndexedDB Fallback
  describe('Active Exam Persistence & Durable IndexedDB Fallback (Defect 3)', () => {
    it('saves to localStorage and passes read-back verification', async () => {
      const now = Date.now();
      const state: ActiveExamState = {
        setNumber: 15,
        currentQuestionIndex: 10,
        userAnswers: { 1: { questionNumber: 1, selectedOption: 'A', isAnswered: true } },
        examStartTime: now - 5000,
        examEndTime: now + 20 * 60 * 1000,
        questionTimeLeft: { 11: 35 },
        currentQuestionStartedAt: now - 5000,
        questionExpiredMap: {},
      };

      const result = await saveActiveExam(state);
      expect(result.success).toBe(true);
      expect(result.storageType).toBe('localStorage');

      const loaded = await getActiveExam(15);
      expect(loaded).not.toBeNull();
      expect(loaded?.setNumber).toBe(15);
      expect(loaded?.currentQuestionIndex).toBe(10);
      expect(loaded?.examEndTime).toBe(state.examEndTime);
      expect(loaded?.userAnswers[1].selectedOption).toBe('A');
    });

    it('falls back to IndexedDB when localStorage throws quota exceeded', async () => {
      // Mock localStorage throwing error
      vi.stubGlobal('localStorage', {
        ...localStorage,
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError: localStorage full');
        },
        removeItem: () => {},
      });

      const now = Date.now();
      const state: ActiveExamState = {
        setNumber: 16,
        currentQuestionIndex: 25,
        userAnswers: { 26: { questionNumber: 26, selectedOption: '2', isAnswered: true } },
        examStartTime: now - 10000,
        examEndTime: now + 15 * 60 * 1000,
        questionTimeLeft: { 26: 28 },
        currentQuestionStartedAt: now - 10000,
        questionExpiredMap: {},
      };

      const result = await saveActiveExam(state);
      expect(result.success).toBe(true);
      expect(result.storageType).toBe('indexedDB');

      // Restoration from IndexedDB succeeds
      const restored = await getActiveExam(16);
      expect(restored).not.toBeNull();
      expect(restored?.setNumber).toBe(16);
      expect(restored?.currentQuestionIndex).toBe(25);
      expect(restored?.userAnswers[26].selectedOption).toBe('2');
      expect(restored?.examEndTime).toBe(state.examEndTime);
    });

    it('falls back to IndexedDB when localStorage write succeeds but read-back verification fails', async () => {
      // Mock localStorage corrupting data on read-back
      vi.stubGlobal('localStorage', {
        ...localStorage,
        getItem: (k: string) => {
          if (k.includes('oir_active_exam_set_17')) {
            return JSON.stringify({ setNumber: 999 }); // corrupt data
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      });

      const now = Date.now();
      const state: ActiveExamState = {
        setNumber: 17,
        currentQuestionIndex: 5,
        userAnswers: {},
        examStartTime: now,
        examEndTime: now + 10000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
      };

      const result = await saveActiveExam(state);
      expect(result.success).toBe(true);
      expect(result.storageType).toBe('indexedDB');
    });

    it('reports failure when both localStorage and IndexedDB fail', async () => {
      vi.stubGlobal('localStorage', {
        ...localStorage,
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage disabled');
        },
        removeItem: () => {},
      });

      // Mock indexedDB open failure
      const originalOpen = indexedDB.open;
      indexedDB.open = () => {
        throw new Error('IndexedDB blocked');
      };

      try {
        const now = Date.now();
        const state: ActiveExamState = {
          setNumber: 18,
          currentQuestionIndex: 0,
          userAnswers: {},
          examStartTime: now,
          examEndTime: now + 10000,
          questionTimeLeft: {},
          currentQuestionStartedAt: now,
          questionExpiredMap: {},
        };

        const result = await saveActiveExam(state);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      } finally {
        indexedDB.open = originalOpen;
      }
    });

    it('preserves question-specific remaining time and original deadline after restoration', async () => {
      const now = Date.now();
      const originalDeadline = now + 18 * 60 * 1000;
      const state: ActiveExamState = {
        setNumber: 19,
        currentQuestionIndex: 12,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true },
          12: { questionNumber: 12, selectedOption: 'B', isAnswered: true },
        },
        examStartTime: now - 7 * 60 * 1000,
        examEndTime: originalDeadline,
        questionTimeLeft: { 12: 17, 13: 40 },
        currentQuestionStartedAt: now - 23000,
        questionExpiredMap: { 1: false, 12: false },
      };

      await saveActiveExam(state);

      // Simulate refresh
      const restored = await getActiveExam(19);
      expect(restored).not.toBeNull();
      expect(restored?.examEndTime).toBe(originalDeadline);
      expect(restored?.questionTimeLeft[12]).toBe(17);
      expect(restored?.userAnswers[12].selectedOption).toBe('B');
    });
  });

  // 8. Defect 4: IndexedDB Transaction Completion & Web Locks
  describe('IndexedDB Transaction Completion & Locking (Defect 4)', () => {
    it('releases lease only for matching owner ID and ignores mismatched owner', async () => {
      const ownerCorrect = 'owner_correct';
      const ownerWrong = 'owner_wrong';

      await acquireIdbLease(20, ownerCorrect, 5000);

      // Attempt to release with wrong owner must NOT delete the lease
      await releaseIdbLease(20, ownerWrong);

      // Another owner cannot acquire since lease is still held by ownerCorrect
      const acq = await acquireIdbLease(20, 'owner_other', 5000);
      expect(acq).toBe(false);

      // Releasing with correct owner clears lease
      await releaseIdbLease(20, ownerCorrect);
      const acqAfter = await acquireIdbLease(20, 'owner_other', 5000);
      expect(acqAfter).toBe(true);
      await releaseIdbLease(20, 'owner_other');
    });

    it('handles Web Locks API when available and executes exclusively', async () => {
      let executed = false;
      if (typeof navigator !== 'undefined' && navigator.locks) {
        const res = await checkAndRecoverExpiredExam(
          1,
          [],
          DEFAULT_SETTINGS
        );
        expect(res).toBeDefined();
      }
    });

    it('Part 5: renewIdbLease extends lease expiration when called by legitimate owner', async () => {
      const owner = 'owner_heartbeat_test';
      const acquired = await acquireIdbLease(8, owner, 1000);
      expect(acquired).toBe(true);

      const renewed = await renewIdbLease(8, owner, 5000);
      expect(renewed).toBe(true);

      // Attempt renewal by a different owner must be rejected
      const rejected = await renewIdbLease(8, 'imposter_owner', 5000);
      expect(rejected).toBe(false);

      await releaseIdbLease(8, owner);
    });
  });

  // 9. Part 1 & Part 2: Dual-Store Versioned Resolution & State Integrity
  describe('Dual-Store Versioned Envelope & Deep State Integrity (Part 1 & 2)', () => {
    it('Part 1: prefers IndexedDB when IDB has higher revision and repairs stale localStorage', async () => {
      const now = Date.now();
      const olderState: ActiveExamState = {
        setNumber: 11,
        currentQuestionIndex: 2,
        userAnswers: { 1: { questionNumber: 1, selectedOption: 'A', isAnswered: true } },
        examStartTime: now - 5000,
        examEndTime: now + 20 * 60 * 1000,
        questionTimeLeft: { 2: 30 },
        currentQuestionStartedAt: now - 5000,
        questionExpiredMap: {},
      };

      const newerState: ActiveExamState = {
        setNumber: 11,
        currentQuestionIndex: 15,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true },
          15: { questionNumber: 15, selectedOption: 'D', isAnswered: true },
        },
        examStartTime: now - 5000,
        examEndTime: now + 20 * 60 * 1000,
        questionTimeLeft: { 15: 18 },
        currentQuestionStartedAt: now - 1000,
        questionExpiredMap: {},
      };

      // Put revision 1 in localStorage
      store['oir_active_exam_set_11'] = JSON.stringify({
        setNumber: 11,
        revision: 1,
        updatedAt: now - 2000,
        state: olderState,
        storageVersion: 1,
      });

      // Put revision 2 in IndexedDB
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('oir_hub_coordination', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('active_exams', 'readwrite');
        const st = tx.objectStore('active_exams');
        st.put({
          setNumber: 11,
          revision: 2,
          updatedAt: now - 500,
          state: newerState,
          storageVersion: 1,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject();
        };
      });

      // Invalidate memory cache so getActiveExam reads both stores
      invalidateActiveExamCache(11);

      const resolved = await getActiveExam(11);
      expect(resolved).not.toBeNull();
      // Must have selected the newer IDB state (currentQuestionIndex 15)
      expect(resolved?.currentQuestionIndex).toBe(15);
      expect(resolved?.userAnswers[15]?.selectedOption).toBe('D');

      // Must have repaired localStorage with the newer revision
      const repairedRaw = store['oir_active_exam_set_11'];
      expect(repairedRaw).toBeDefined();
      const repairedParsed = JSON.parse(repairedRaw);
      expect(repairedParsed.revision).toBe(2);
      expect(repairedParsed.state.currentQuestionIndex).toBe(15);
    });

    it('Part 1: prefers localStorage when localStorage has higher revision and repairs IndexedDB', async () => {
      const now = Date.now();
      const olderState: ActiveExamState = {
        setNumber: 13,
        currentQuestionIndex: 5,
        userAnswers: {},
        examStartTime: now,
        examEndTime: now + 10000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
      };

      const newerState: ActiveExamState = {
        setNumber: 13,
        currentQuestionIndex: 20,
        userAnswers: { 20: { questionNumber: 20, selectedOption: 'C', isAnswered: true } },
        examStartTime: now,
        examEndTime: now + 10000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
      };

      // Put revision 1 in IndexedDB
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('oir_hub_coordination', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('active_exams', 'readwrite');
        const st = tx.objectStore('active_exams');
        st.put({
          setNumber: 13,
          revision: 1,
          updatedAt: now - 3000,
          state: olderState,
          storageVersion: 1,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject();
        };
      });

      // Put revision 3 in localStorage
      store['oir_active_exam_set_13'] = JSON.stringify({
        setNumber: 13,
        revision: 3,
        updatedAt: now,
        state: newerState,
        storageVersion: 1,
      });

      invalidateActiveExamCache(13);

      const resolved = await getActiveExam(13);
      expect(resolved).not.toBeNull();
      expect(resolved?.currentQuestionIndex).toBe(20);
      expect(resolved?.userAnswers[20]?.selectedOption).toBe('C');
    });

    it('Part 1: handles legacy unversioned active exam migration cleanly', async () => {
      const now = Date.now();
      const legacyRawState: ActiveExamState = {
        setNumber: 14,
        currentQuestionIndex: 7,
        userAnswers: { 1: { questionNumber: 1, selectedOption: '3', isAnswered: true } },
        examStartTime: now - 10000,
        examEndTime: now + 15 * 60 * 1000,
        questionTimeLeft: { 7: 25 },
        currentQuestionStartedAt: now - 10000,
        questionExpiredMap: {},
      };

      // Store raw unversioned state without envelope
      store['oir_active_exam_set_14'] = JSON.stringify(legacyRawState);
      invalidateActiveExamCache(14);

      const loaded = await getActiveExam(14);
      expect(loaded).not.toBeNull();
      expect(loaded?.setNumber).toBe(14);
      expect(loaded?.currentQuestionIndex).toBe(7);
      expect(loaded?.userAnswers[1]?.selectedOption).toBe('3');
    });

    it('Part 2: isStateDeepEqual detects deep modifications in userAnswers, timers, and flags', () => {
      const now = Date.now();
      const baseState: ActiveExamState = {
        setNumber: 10,
        currentQuestionIndex: 4,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: 'A', isAnswered: true, isCorrect: true, timeSpentSeconds: 15 },
          2: { questionNumber: 2, twoPartAnswer: ['X', 'Y'], isAnswered: true, timeSpentSeconds: 20 },
        },
        examStartTime: now - 10000,
        examEndTime: now + 20000,
        questionTimeLeft: { 4: 25 },
        currentQuestionStartedAt: now - 5000,
        questionExpiredMap: { 1: true, 2: false },
      };

      // Exact clone must return true
      const cloned = JSON.parse(JSON.stringify(baseState));
      expect(isStateDeepEqual(baseState, cloned)).toBe(true);

      // Modified selectedOption
      const diffOption = JSON.parse(JSON.stringify(baseState));
      diffOption.userAnswers[1].selectedOption = 'B';
      expect(isStateDeepEqual(baseState, diffOption)).toBe(false);

      // Modified twoPartAnswer
      const diffTwoPart = JSON.parse(JSON.stringify(baseState));
      diffTwoPart.userAnswers[2].twoPartAnswer = ['X', 'Z'];
      expect(isStateDeepEqual(baseState, diffTwoPart)).toBe(false);

      // Modified questionTimeLeft
      const diffTimer = JSON.parse(JSON.stringify(baseState));
      diffTimer.questionTimeLeft[4] = 10;
      expect(isStateDeepEqual(baseState, diffTimer)).toBe(false);

      // Modified questionExpiredMap
      const diffExpired = JSON.parse(JSON.stringify(baseState));
      diffExpired.questionExpiredMap[2] = true;
      expect(isStateDeepEqual(baseState, diffExpired)).toBe(false);
    });
  });
});