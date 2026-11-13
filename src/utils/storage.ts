import {
  UserSettings,
  TestAttempt,
  SetProgress,
  ActiveExamState,
  OverallStats,
  Question,
} from '../types/oir';
import { buildTestAttempt } from './scoring';

const SETTINGS_KEY = 'oir_user_settings_v1';
const ATTEMPTS_KEY = 'oir_test_attempts_v1';
const ACTIVE_EXAM_PREFIX = 'oir_active_exam_set_';
const SUBMISSION_GUARD_KEY = 'oir_submitting_guard_';

export const DEFAULT_SETTINGS: UserSettings = {
  questionTimeSeconds: 40,
  totalDurationMinutes: 25,
  soundEnabled: true,
};

// ----------------- SETTINGS -----------------

export function getUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      questionTimeSeconds: Number(parsed.questionTimeSeconds) || DEFAULT_SETTINGS.questionTimeSeconds,
      totalDurationMinutes: Number(parsed.totalDurationMinutes) || DEFAULT_SETTINGS.totalDurationMinutes,
      soundEnabled: parsed.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveUserSettings(settings: Partial<UserSettings>): UserSettings {
  const current = getUserSettings();
  const updated: UserSettings = {
    questionTimeSeconds: Math.max(5, Number(settings.questionTimeSeconds) || current.questionTimeSeconds),
    totalDurationMinutes: Math.max(1, Number(settings.totalDurationMinutes) || current.totalDurationMinutes),
    soundEnabled: settings.soundEnabled ?? current.soundEnabled,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}

export function resetUserSettings(): UserSettings {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
  return DEFAULT_SETTINGS;
}

// ----------------- ATTEMPTS & PROGRESS -----------------

export interface SaveAttemptResult {
  success: boolean;
  error?: string;
  attemptId?: string;
}

/**
 * Task 4: Normalize legacy attempt records to ensure full compatibility
 * with Set 06 Q11 scoring exclusion and the new maxScore/excludedQuestions schema.
 */
export function normalizeLegacyAttempt(att: TestAttempt): TestAttempt {
  if (!att) return att;

  // Set 06 normalization
  if (att.setNumber === 6) {
    const isAlreadyNormalized = att.maxScore === 49 && att.excludedQuestions === 1;
    if (isAlreadyNormalized) return att;

    let newCorrect = att.correctAnswers ?? att.score ?? 0;
    let newIncorrect = att.incorrectAnswers ?? 0;
    let newUnanswered = att.unansweredQuestions ?? 0;
    const newAnswers = att.userAnswers ? { ...att.userAnswers } : {};

    // Check if Q11 is in userAnswers
    if (newAnswers[11]) {
      const q11 = newAnswers[11];
      if (q11.isCorrect) {
        newCorrect = Math.max(0, newCorrect - 1);
      } else if (q11.isAnswered) {
        newIncorrect = Math.max(0, newIncorrect - 1);
      } else {
        newUnanswered = Math.max(0, newUnanswered - 1);
      }
      newAnswers[11] = {
        ...q11,
        isCorrect: false,
        isExcluded: true,
      };
    } else {
      // If Q11 is not specifically detailed in userAnswers, safely adjust from incorrect/unanswered
      if (newUnanswered > 0) {
        newUnanswered--;
      } else if (newIncorrect > 0) {
        newIncorrect--;
      }
    }

    const answeredScored = newCorrect + newIncorrect;
    const accuracy = answeredScored > 0 ? Math.round((newCorrect / answeredScored) * 100) : 0;

    return {
      ...att,
      maxScore: 49,
      excludedQuestions: 1,
      correctAnswers: newCorrect,
      incorrectAnswers: newIncorrect,
      unansweredQuestions: newUnanswered,
      score: newCorrect,
      accuracyPercentage: accuracy,
      userAnswers: newAnswers,
    };
  }

  // Non-Set 06 sets
  if (att.maxScore === undefined || att.excludedQuestions === undefined) {
    const totalQ = att.totalQuestions || 50;
    return {
      ...att,
      maxScore: totalQ,
      excludedQuestions: 0,
      totalQuestions: totalQ,
    };
  }

  return att;
}

export function getAllAttempts(): TestAttempt[] {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return [];
    const list: TestAttempt[] = JSON.parse(raw);
    return list.map(normalizeLegacyAttempt);
  } catch {
    return [];
  }
}

export function getAttemptsForSet(setNumber: number): TestAttempt[] {
  return getAllAttempts().filter((a) => a.setNumber === setNumber);
}

export function saveAttempt(attempt: TestAttempt): SaveAttemptResult {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    const all: TestAttempt[] = raw ? JSON.parse(raw) : [];

    // Idempotency: guard against duplicate attempt ID
    const exists = all.some((a) => a.attemptId === attempt.attemptId);
    if (!exists) {
      all.push(attempt);
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(all));
    }

    // Verify write actually persisted to storage
    const verifyRaw = localStorage.getItem(ATTEMPTS_KEY);
    if (!verifyRaw) {
      return { success: false, error: 'Storage verification failed: ATTEMPTS_KEY empty' };
    }
    const verifyList: TestAttempt[] = JSON.parse(verifyRaw);
    const inHistory = verifyList.some((a) => a.attemptId === attempt.attemptId);
    if (!inHistory) {
      return { success: false, error: 'Verification failed: attemptId not found in history' };
    }

    return { success: true, attemptId: attempt.attemptId };
  } catch (err: unknown) {
    console.error('Failed to save test attempt:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Storage write failed',
    };
  }
}

/**
 * Task 5: Fix Dashboard Status During Retakes
 * Active exam takes priority for display status ('in_progress') while
 * preserving completed attempts count, bestScore, and lastAttemptTimestamp!
 */
export function getSetProgress(setNumber: number): SetProgress {
  const attempts = getAttemptsForSet(setNumber);
  const activeExam = getActiveExam(setNumber);

  const hasPreviousAttempts = attempts.length > 0;
  const bestScore = hasPreviousAttempts ? Math.max(...attempts.map((a) => a.score)) : undefined;
  const lastAttempt = hasPreviousAttempts ? attempts[attempts.length - 1] : undefined;

  // If there is an active exam currently in progress:
  if (activeExam) {
    return {
      setNumber,
      status: 'in_progress',
      attemptsCount: attempts.length,
      bestScore,
      lastAttemptTimestamp: lastAttempt?.timestamp,
    };
  }

  // If completed with no active retake in progress:
  if (hasPreviousAttempts) {
    return {
      setNumber,
      status: 'completed',
      attemptsCount: attempts.length,
      bestScore,
      lastAttemptTimestamp: lastAttempt?.timestamp,
    };
  }

  // Not started yet
  return {
    setNumber,
    status: 'not_started',
    attemptsCount: 0,
  };
}

export function getAllSetProgress(): Record<number, SetProgress> {
  const progressMap: Record<number, SetProgress> = {};
  for (let s = 1; s <= 20; s++) {
    progressMap[s] = getSetProgress(s);
  }
  return progressMap;
}

/**
 * Task 9: Clearly defined metrics
 * Questions Practiced = questions actually answered across all attempts.
 * Overall Accuracy = Total Correct / Questions Answered * 100%.
 */
export function getOverallStats(): OverallStats {
  const attempts = getAllAttempts();
  const progress = getAllSetProgress();

  let completedSetsCount = 0;
  for (let s = 1; s <= 20; s++) {
    if (progress[s].status === 'completed') {
      completedSetsCount++;
    }
  }

  const totalAttempts = attempts.length;

  let totalCorrect = 0;
  let questionsAnswered = 0;
  let bestPerformance = 0;

  for (const att of attempts) {
    totalCorrect += att.correctAnswers;
    // Count questions actually answered in this attempt (excluding excluded questions)
    let attAnswered = 0;
    if (att.userAnswers) {
      Object.values(att.userAnswers).forEach((u) => {
        if (u.isAnswered && !u.isExcluded) attAnswered++;
      });
    } else {
      attAnswered = att.correctAnswers + att.incorrectAnswers;
    }
    questionsAnswered += attAnswered;

    if (att.score > bestPerformance) {
      bestPerformance = att.score;
    }
  }

  const overallAccuracy =
    questionsAnswered > 0 ? Math.round((totalCorrect / questionsAnswered) * 100) : 0;

  return {
    totalPracticeSets: 20,
    completedSets: completedSetsCount,
    totalAttempts,
    totalQuestionsPracticed: questionsAnswered,
    questionsAnswered,
    overallAccuracy,
    bestPerformance,
  };
}

// ----------------- ACTIVE EXAM & RECOVERY (TASK 6 & TASK 7) -----------------

export function getActiveExam(setNumber: number): ActiveExamState | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_EXAM_PREFIX}${setNumber}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveActiveExam(state: ActiveExamState): void {
  try {
    localStorage.setItem(`${ACTIVE_EXAM_PREFIX}${state.setNumber}`, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save active exam state:', err);
  }
}

export function clearActiveExam(setNumber: number): void {
  try {
    localStorage.removeItem(`${ACTIVE_EXAM_PREFIX}${setNumber}`);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(`${SUBMISSION_GUARD_KEY}${setNumber}`);
    }
  } catch {
    // Ignore storage clear errors in headless environments
  }
}

// ----------------- CROSS-TAB RECOVERY COORDINATION (TASK 2) -----------------

const LOCK_KEY_PREFIX = 'oir_recovery_lock_';
const LOCK_TIMEOUT_MS = 5000; // 5-second automatic expiration prevents stale locks

export function acquireRecoveryLock(setNumber: number, ownerId: string): boolean {
  try {
    const key = `${LOCK_KEY_PREFIX}${setNumber}`;
    const raw = localStorage.getItem(key);
    const now = Date.now();
    if (raw) {
      try {
        const lock = JSON.parse(raw);
        if (lock.expiresAt > now && lock.owner !== ownerId) {
          // Lock is actively held by another tab/process
          return false;
        }
      } catch {
        // Corrupted lock payload, safe to overwrite
      }
    }
    localStorage.setItem(
      key,
      JSON.stringify({ owner: ownerId, expiresAt: now + LOCK_TIMEOUT_MS })
    );
    return true;
  } catch {
    return true; // Fallback to idempotent history check if localStorage lock throws
  }
}

export function releaseRecoveryLock(setNumber: number, ownerId: string): void {
  try {
    const key = `${LOCK_KEY_PREFIX}${setNumber}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const lock = JSON.parse(raw);
      if (lock.owner === ownerId) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Task 2 & Task 3: Reliable Expired Exam Recovery with Cross-Tab Coordination.
 * - Idempotently checks if the attempt is already in permanent history.
 * - Coordinates via cross-tab locks to prevent duplicate submissions between concurrent tabs.
 * - Preserves original exam deadline (activeExam.examEndTime) as attempt timestamp.
 * - Clears active exam ONLY after successful, verified persistence to permanent storage.
 * - If persistence fails, active exam is retained and null is returned.
 */
export function checkAndRecoverExpiredExam(
  setNumber: number,
  questions: Question[],
  settings: UserSettings
): TestAttempt | null {
  const activeExam = getActiveExam(setNumber);
  if (!activeExam) {
    // Cross-tab check: if another tab already recovered this set recently, retrieve it from history
    try {
      const recentRaw = localStorage.getItem(`oir_recent_recovery_${setNumber}`);
      if (recentRaw) {
        const { attemptId, expiresAt } = JSON.parse(recentRaw);
        if (expiresAt > Date.now()) {
          const match = getAllAttempts().find((a) => a.attemptId === attemptId);
          if (match) return match;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  const now = Date.now();
  // Check if overall timer expired
  if (activeExam.examEndTime > now) {
    return null; // Not expired yet
  }

  // Derive stable deterministic attempt ID from the examination session
  const totalDurationMs = settings.totalDurationMinutes * 60 * 1000;
  const examSessionStart = activeExam.examStartTime || (activeExam.examEndTime - totalDurationMs);
  const stableAttemptId = `att_${setNumber}_${examSessionStart}`;

  // Multi-tab coordination: check if already recovered by another tab
  const allAttempts = getAllAttempts();
  const existingAttempt = allAttempts.find((a) => a.attemptId === stableAttemptId);
  if (existingAttempt) {
    clearActiveExam(setNumber);
    try {
      localStorage.setItem(
        `oir_recent_recovery_${setNumber}`,
        JSON.stringify({ attemptId: stableAttemptId, expiresAt: Date.now() + 30000 })
      );
    } catch {
      // Ignore
    }
    return existingAttempt;
  }

  // Cross-tab lock to prevent race condition between concurrent tabs
  const ownerId = `tab_${now}_${Math.random().toString(36).substring(2, 9)}`;
  const lockAcquired = acquireRecoveryLock(setNumber, ownerId);
  if (!lockAcquired) {
    // Another tab is currently recovering this exam; check if history already has it
    const recheck = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (recheck) {
      clearActiveExam(setNumber);
      return recheck;
    }
    return null;
  }

  try {
    // Double-check history under acquired lock
    const historyUnderLock = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (historyUnderLock) {
      clearActiveExam(setNumber);
      return historyUnderLock;
    }

    // Calculate total test time
    const totalTimeSeconds = settings.totalDurationMinutes * 60;

    // TASK 3: Preserve original exam expiration timestamp (activeExam.examEndTime), NOT Date.now()!
    const attempt = buildTestAttempt(
      setNumber,
      questions,
      activeExam.userAnswers || {},
      totalTimeSeconds,
      stableAttemptId,
      activeExam.examEndTime
    );

    // Persist attempt safely
    const saveResult = saveAttempt(attempt);
    if (!saveResult.success) {
      console.error('Failed to persist recovered exam. Retaining active exam state:', saveResult.error);
      return null;
    }

    // Verify it exists in permanent attempt history before clearing active exam
    const verifiedAttempts = getAllAttempts();
    const isSaved = verifiedAttempts.some((a) => a.attemptId === stableAttemptId);
    if (!isSaved) {
      console.error('Attempt was not verified in permanent attempt history. Retaining active exam state.');
      return null;
    }

    // Clear active exam state ONLY after successful, verified persistence
    clearActiveExam(setNumber);

    try {
      localStorage.setItem(
        `oir_recent_recovery_${setNumber}`,
        JSON.stringify({ attemptId: stableAttemptId, expiresAt: Date.now() + 30000 })
      );
    } catch {
      // Ignore
    }

    return attempt;
  } finally {
    releaseRecoveryLock(setNumber, ownerId);
  }
}

export function clearAllUserData(): void {
  localStorage.removeItem(ATTEMPTS_KEY);
  for (let s = 1; s <= 20; s++) {
    clearActiveExam(s);
    try {
      localStorage.removeItem(`oir_recent_recovery_${s}`);
      localStorage.removeItem(`${LOCK_KEY_PREFIX}${s}`);
    } catch {
      // Ignore
    }
  }
}
