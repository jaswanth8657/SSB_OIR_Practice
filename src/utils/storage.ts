import {
  UserSettings,
  TestAttempt,
  SetProgress,
  ActiveExamState,
  OverallStats,
  Question,
  RecoveryResult,
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
 * Task 3: Evidence-based Legacy Attempt Normalization.
 * - CASE A: Q11 answer record exists with reliable grading information -> removes Q11 from credited score/counts.
 * - CASE B: Q11 answer record is missing / incomplete -> NEVER guesses answers or deductions!
 *   Preserves recorded score, marks attempt as legacy_unverified / review_required, attaches explanatory note.
 * - CASE C: Already normalized attempt (maxScore: 49, excludedQuestions: 1) -> leaves unchanged.
 */
export function normalizeLegacyAttempt(att: TestAttempt): TestAttempt {
  if (!att) return att;

  // Set 06 normalization
  if (att.setNumber === 6) {
    // Case C: Already normalized attempt with verified status
    if (att.maxScore === 49 && att.excludedQuestions === 1 && att.legacyStatus !== 'review_required') {
      return att;
    }

    // Check if Q11 answer record exists with reliable grading information
    const hasQ11 = Boolean(att.userAnswers && att.userAnswers[11] && typeof att.userAnswers[11] === 'object');

    if (hasQ11) {
      // Case A: Q11 answer record exists with reliable data
      let newCorrect = att.correctAnswers ?? att.score ?? 0;
      let newIncorrect = att.incorrectAnswers ?? 0;
      let newUnanswered = att.unansweredQuestions ?? 0;
      const newAnswers = { ...att.userAnswers };
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

      const answeredScored = newCorrect + newIncorrect;
      const accuracy = answeredScored > 0 ? Math.round((newCorrect / answeredScored) * 100) : 0;

      return {
        ...att,
        maxScore: 49,
        excludedQuestions: 1,
        totalQuestions: att.totalQuestions || 50,
        correctAnswers: newCorrect,
        incorrectAnswers: newIncorrect,
        unansweredQuestions: newUnanswered,
        score: newCorrect,
        accuracyPercentage: accuracy,
        userAnswers: newAnswers,
        isLegacyUnverified: false,
        legacyStatus: 'verified',
      };
    } else {
      // Case B: Q11 answer record does NOT exist
      // DO NOT GUESS whether Q11 was correct, incorrect, or unanswered!
      return {
        ...att,
        score: att.score,
        correctAnswers: att.correctAnswers ?? att.score ?? 0,
        incorrectAnswers: att.incorrectAnswers ?? 0,
        unansweredQuestions: att.unansweredQuestions ?? 0,
        totalQuestions: att.totalQuestions || 50,
        maxScore: att.maxScore || 50,
        excludedQuestions: att.excludedQuestions || 0,
        originalScore: att.score,
        isLegacyUnverified: true,
        legacyStatus: 'review_required',
        legacyNote:
          'This is a historical attempt created before Question 11 was excluded from scoring. The original Question 11 response could not be verified, so the historical score has been retained as recorded.',
      };
    }
  }

  // Non-Set 06 sets: ensure schema consistency
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

const WEB_LOCK_PREFIX = 'oir-exam-recovery-set-';
const LEASE_TIMEOUT_MS = 5000; // 5-second lease prevents stale locks while ensuring safe completion
const IDB_DB_NAME = 'oir_hub_coordination';
const IDB_STORE_NAME = 'leases';
const IDB_VERSION = 1;

/**
 * Open or initialize coordination IndexedDB database.
 */
function openCoordinationDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in current environment'));
    }
    try {
      const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB coordination database'));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Atomically inspects and claims a recovery lease in an IndexedDB readwrite transaction.
 */
export async function acquireIdbLease(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS
): Promise<boolean> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const key = `set_${setNumber}`;
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        const now = Date.now();
        if (existing && existing.expiresAt > now && existing.ownerId !== ownerId) {
          // Actively held by another tab/process
          resolve(false);
          return;
        }
        // Claim or renew lease
        const putReq = store.put({ key, setNumber, ownerId, expiresAt: now + ttlMs });
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => resolve(false);
      };
      getReq.onerror = () => resolve(false);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

/**
 * Releases lease only if currently owned by the caller. Never releases another tab's lease.
 */
export async function releaseIdbLease(setNumber: number, ownerId: string): Promise<void> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const key = `set_${setNumber}`;
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && existing.ownerId === ownerId) {
          store.delete(key);
        }
        resolve();
      };
      getReq.onerror = () => resolve();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore
  }
}

/**
 * Executes a recovery critical section inside an exclusive cross-tab lock.
 * Primary: Web Locks API (`navigator.locks.request`).
 * Fallback: Transactional IndexedDB Lease with owner token & TTL.
 * Fail-safe: Fails safely with error if no reliable locking primitive is available.
 */
export async function withRecoveryLock<T>(
  setNumber: number,
  callback: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false; error: string }> {
  // 1. PRIMARY MECHANISM: Web Locks API
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      const lockName = `${WEB_LOCK_PREFIX}${setNumber}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LEASE_TIMEOUT_MS);

      let lockExecuted = false;
      let execResult: T;

      await navigator.locks.request(
        lockName,
        { mode: 'exclusive', signal: controller.signal },
        async (lock) => {
          clearTimeout(timeoutId);
          if (!lock) return;
          lockExecuted = true;
          execResult = await callback();
        }
      );

      if (lockExecuted) {
        return { acquired: true, result: execResult! };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { acquired: false, error: 'Web Lock request timed out after 5 seconds' };
      }
      // If Web Locks throws, fall through to IndexedDB fallback
    }
  }

  // 2. FALLBACK MECHANISM: IndexedDB Transaction-based Lease
  if (typeof indexedDB !== 'undefined') {
    const ownerId = `owner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const acquired = await acquireIdbLease(setNumber, ownerId, LEASE_TIMEOUT_MS);
    if (!acquired) {
      return {
        acquired: false,
        error: `Recovery lease for Set ${setNumber} is currently held by another browser tab`,
      };
    }
    try {
      const result = await callback();
      return { acquired: true, result };
    } finally {
      await releaseIdbLease(setNumber, ownerId);
    }
  }

  // 3. FAIL-SAFE: Do not claim locking succeeded when no reliable primitive is available
  return {
    acquired: false,
    error: 'No reliable lock mechanism (Web Locks or IndexedDB) available in current environment',
  };
}

/**
 * Backwards compatibility helper for synchronous lock checks.
 */
export function acquireRecoveryLock(setNumber: number, ownerId: string): boolean {
  try {
    const key = `oir_recovery_lock_${setNumber}`;
    const raw = localStorage.getItem(key);
    const now = Date.now();
    if (raw) {
      const lock = JSON.parse(raw);
      if (lock.expiresAt > now && lock.owner !== ownerId) {
        return false;
      }
    }
    localStorage.setItem(
      key,
      JSON.stringify({ owner: ownerId, expiresAt: now + LEASE_TIMEOUT_MS })
    );
    return true;
  } catch {
    return false; // NEVER return true on lock failure
  }
}

export function releaseRecoveryLock(setNumber: number, ownerId: string): void {
  try {
    const key = `oir_recovery_lock_${setNumber}`;
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
 * Notifies other browser tabs via BroadcastChannel when an exam recovery completes.
 */
function notifyRecoveryComplete(setNumber: number, attemptId: string): void {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('oir_recovery_channel');
      channel.postMessage({
        type: 'recovery_complete',
        setNumber,
        attemptId,
        timestamp: Date.now(),
      });
      channel.close();
    } catch {
      // Ignore
    }
  }
}

/**
 * Task 2 & Task 4: Reliable Asynchronous Expired Exam Recovery with Cross-Tab Coordination.
 * - Idempotently checks if the attempt is already in permanent history.
 * - Coordinates via exclusive Web Locks API (with transactional IndexedDB fallback).
 * - Preserves original exam deadline (activeExam.examEndTime) as attempt timestamp.
 * - Clears active exam ONLY after successful, verified persistence to permanent storage.
 * - Returns structured RecoveryResult distinguishing success, already recovered, pending, storage_error, lock_unavailable.
 */
export async function checkAndRecoverExpiredExam(
  setNumber: number,
  questions: Question[],
  settings: UserSettings
): Promise<RecoveryResult> {
  const activeExam = getActiveExam(setNumber);
  if (!activeExam) {
    // Cross-tab check: if another tab already recovered this set recently, retrieve it from history
    try {
      const recentRaw = localStorage.getItem(`oir_recent_recovery_${setNumber}`);
      if (recentRaw) {
        const { attemptId, expiresAt } = JSON.parse(recentRaw);
        if (expiresAt > Date.now()) {
          const match = getAllAttempts().find((a) => a.attemptId === attemptId);
          if (match) return { status: 'already_recovered', attempt: match };
        }
      }
    } catch {
      // Ignore
    }
    return { status: 'no_active_exam' };
  }

  const now = Date.now();
  // Check if overall timer expired
  if (activeExam.examEndTime > now) {
    return { status: 'not_expired' };
  }

  // Derive stable deterministic attempt ID from the examination session
  const totalDurationMs = settings.totalDurationMinutes * 60 * 1000;
  const examSessionStart = activeExam.examStartTime || (activeExam.examEndTime - totalDurationMs);
  const stableAttemptId = `att_${setNumber}_${examSessionStart}`;

  // Multi-tab coordination: fast check if already recovered and persisted by another tab
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
    return { status: 'already_recovered', attempt: existingAttempt };
  }

  // Acquire exclusive cross-tab lock covering recovery and persistence
  const lockResult = await withRecoveryLock(setNumber, async () => {
    // Double-check history under acquired lock
    const historyUnderLock = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (historyUnderLock) {
      clearActiveExam(setNumber);
      return { status: 'already_recovered' as const, attempt: historyUnderLock };
    }

    // Calculate total test time
    const totalTimeSeconds = settings.totalDurationMinutes * 60;

    // Preserve original exam expiration timestamp (activeExam.examEndTime)
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
      return {
        status: 'storage_error' as const,
        setNumber,
        message: saveResult.error || 'Failed to persist recovered examination',
      };
    }

    // Verify it exists in permanent attempt history before clearing active exam
    const verifiedAttempts = getAllAttempts();
    const isSaved = verifiedAttempts.some((a) => a.attemptId === stableAttemptId);
    if (!isSaved) {
      return {
        status: 'storage_error' as const,
        setNumber,
        message: 'Persistence verification failed: recovered attempt not confirmed in storage',
      };
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

    // Notify other tabs
    notifyRecoveryComplete(setNumber, stableAttemptId);

    return { status: 'recovered' as const, attempt };
  });

  if (!lockResult.acquired) {
    // If lock was not acquired, re-check if another tab just completed recovery
    const recheck = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (recheck) {
      clearActiveExam(setNumber);
      return { status: 'already_recovered', attempt: recheck };
    }

    return {
      status: 'lock_unavailable',
      setNumber,
      message: lockResult.error || `Could not acquire exclusive recovery lock for Set ${setNumber}`,
    };
  }

  return lockResult.result;
}

export function clearAllUserData(): void {
  localStorage.removeItem(ATTEMPTS_KEY);
  for (let s = 1; s <= 20; s++) {
    clearActiveExam(s);
    try {
      localStorage.removeItem(`oir_recent_recovery_${s}`);
      localStorage.removeItem(`oir_recovery_lock_${s}`);
    } catch {
      // Ignore
    }
  }
}
