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

export function getAllAttempts(): TestAttempt[] {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function getAttemptsForSet(setNumber: number): TestAttempt[] {
  return getAllAttempts().filter((a) => a.setNumber === setNumber);
}

export function saveAttempt(attempt: TestAttempt): void {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    const all: TestAttempt[] = raw ? JSON.parse(raw) : [];

    // Idempotency: guard against duplicate attempt ID
    const exists = all.some((a) => a.attemptId === attempt.attemptId);
    if (!exists) {
      all.push(attempt);
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(all));
    }
  } catch (err) {
    console.error('Failed to save test attempt:', err);
  }
}

export function getSetProgress(setNumber: number): SetProgress {
  const attempts = getAttemptsForSet(setNumber);
  const activeExam = getActiveExam(setNumber);

  if (attempts.length > 0) {
    const bestScore = Math.max(...attempts.map((a) => a.score));
    const lastAttempt = attempts[attempts.length - 1];
    return {
      setNumber,
      status: 'completed',
      attemptsCount: attempts.length,
      bestScore,
      lastAttemptTimestamp: lastAttempt.timestamp,
    };
  }

  if (activeExam) {
    return {
      setNumber,
      status: 'in_progress',
      attemptsCount: 0,
    };
  }

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

/**
 * Task 3 & Task 6 & Task 7: Expired Exam Recovery
 * If overall exam timer has expired, evaluates saved answers using the shared scoring engine,
 * records the completed attempt with a stable deterministic attemptId, and safely clears active state.
 */
export function checkAndRecoverExpiredExam(
  setNumber: number,
  questions: Question[],
  settings: UserSettings
): TestAttempt | null {
  const activeExam = getActiveExam(setNumber);
  if (!activeExam) return null;

  const now = Date.now();
  // Check if overall timer expired
  if (activeExam.examEndTime > now) {
    return null; // Not expired yet
  }

  // Derive stable deterministic attempt ID from the examination session
  const examSessionStart = activeExam.examStartTime || (activeExam.examEndTime - settings.totalDurationMinutes * 60 * 1000);
  const stableAttemptId = `att_${setNumber}_${examSessionStart}`;

  // Check if this attempt was already recorded in history
  const allAttempts = getAllAttempts();
  const existingAttempt = allAttempts.find((a) => a.attemptId === stableAttemptId);
  if (existingAttempt) {
    // Already saved; clean up residual active exam and return the existing attempt
    clearActiveExam(setNumber);
    return existingAttempt;
  }

  // Calculate total test time
  const totalTimeSeconds = settings.totalDurationMinutes * 60;

  // Grade using shared production scoring engine
  const attempt = buildTestAttempt(
    setNumber,
    questions,
    activeExam.userAnswers || {},
    totalTimeSeconds,
    stableAttemptId,
    now
  );

  // Persist attempt safely
  saveAttempt(attempt);

  // Clear active exam state ONLY after successful persistence
  clearActiveExam(setNumber);

  return attempt;
}

export function clearAllUserData(): void {
  localStorage.removeItem(ATTEMPTS_KEY);
  for (let s = 1; s <= 20; s++) {
    clearActiveExam(s);
  }
}
