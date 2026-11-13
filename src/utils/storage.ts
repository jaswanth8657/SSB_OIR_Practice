import {
  UserSettings,
  TestAttempt,
  SetProgress,
  ActiveExamState,
  OverallStats,
  Question,
  RecoveryResult,
  ActiveExamSaveResult,
  RecoveryBroadcastMessage,
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
 * Strict Evidence-based Legacy Attempt Normalization for Set 06.
 * - CASE A: Verified correct -> isAnswered === true, isCorrect === true, valid counters >= 1.
 *   Action: correctAnswers -= 1, score -= 1, excludedQuestions = 1, maxScore = 49, legacyStatus = 'verified'.
 * - CASE B: Verified incorrect -> isAnswered === true, isCorrect === false, valid incorrectAnswers >= 1.
 *   Action: incorrectAnswers -= 1, score unchanged, excludedQuestions = 1, maxScore = 49, legacyStatus = 'verified'.
 * - CASE C: Verified unanswered -> isAnswered === false, valid unansweredQuestions >= 1.
 *   Action: unansweredQuestions -= 1, score unchanged, excludedQuestions = 1, maxScore = 49, legacyStatus = 'verified'.
 * - CASE D: Missing, incomplete Q11, malformed booleans, missing/invalid counters, or inconsistent totals.
 *   Action: NEVER guess or hide errors with Math.max. Preserve original score & counters, set isLegacyUnverified = true,
 *   legacyStatus = 'review_required', originalScore = score.
 */
export function normalizeLegacyAttempt(att: TestAttempt): TestAttempt {
  if (!att) return att;
  if (att.setNumber !== 6) {
    if (att.maxScore === undefined || att.excludedQuestions === undefined) {
      return {
        ...att,
        maxScore: att.maxScore || 50,
        excludedQuestions: att.excludedQuestions || 0,
      };
    }
    return att;
  }

  // Idempotency: if already normalized & verified, or already flagged review_required, do not modify
  if (
    att.maxScore === 49 &&
    (att.excludedQuestions === 1 || (Array.isArray(att.excludedQuestions) && att.excludedQuestions.length === 1)) &&
    att.legacyStatus === 'verified'
  ) {
    return att;
  }
  if (att.legacyStatus === 'review_required' && att.isLegacyUnverified) {
    return att;
  }

  const totalQ = att.totalQuestions || 50;

  // Validate aggregate counters
  const isScoreValid = typeof att.score === 'number' && Number.isFinite(att.score) && att.score >= 0;
  const isCorrectValid = typeof att.correctAnswers === 'number' && Number.isFinite(att.correctAnswers) && att.correctAnswers >= 0;
  const isIncorrectValid = typeof att.incorrectAnswers === 'number' && Number.isFinite(att.incorrectAnswers) && att.incorrectAnswers >= 0;
  const isUnansweredValid = typeof att.unansweredQuestions === 'number' && Number.isFinite(att.unansweredQuestions) && att.unansweredQuestions >= 0;

  // Check aggregate totals consistency: in legacy attempts before exclusion, correct + incorrect + unanswered === totalQ
  const areCountsConsistent =
    isCorrectValid &&
    isIncorrectValid &&
    isUnansweredValid &&
    att.correctAnswers + att.incorrectAnswers + att.unansweredQuestions === totalQ;

  // Check score matches correctAnswers in legacy tests
  const isScoreConsistent = isScoreValid && isCorrectValid && att.score === att.correctAnswers;

  // Inspect Q11 record
  const q11 = att.userAnswers && typeof att.userAnswers === 'object' ? att.userAnswers[11] : null;
  const hasValidQ11Obj = q11 !== null && typeof q11 === 'object' && !Array.isArray(q11);

  // CASE A: Verified correct
  if (
    areCountsConsistent &&
    isScoreConsistent &&
    hasValidQ11Obj &&
    q11.isAnswered === true &&
    q11.isCorrect === true &&
    att.correctAnswers >= 1 &&
    att.score >= 1
  ) {
    const newCorrect = att.correctAnswers - 1;
    const newScore = att.score - 1;
    const newIncorrect = att.incorrectAnswers;
    const newUnanswered = att.unansweredQuestions;
    const answeredScored = newCorrect + newIncorrect;
    const accuracy = answeredScored > 0 ? Math.round((newCorrect / answeredScored) * 100) : 0;
    const newAnswers = {
      ...att.userAnswers,
      11: {
        ...q11,
        isCorrect: false,
        isExcluded: true,
      },
    };

    return {
      ...att,
      maxScore: 49,
      excludedQuestions: 1,
      totalQuestions: totalQ,
      correctAnswers: newCorrect,
      incorrectAnswers: newIncorrect,
      unansweredQuestions: newUnanswered,
      score: newScore,
      accuracyPercentage: accuracy,
      userAnswers: newAnswers,
      isLegacyUnverified: false,
      legacyStatus: 'verified',
    };
  }

  // CASE B: Verified incorrect
  if (
    areCountsConsistent &&
    isScoreConsistent &&
    hasValidQ11Obj &&
    q11.isAnswered === true &&
    q11.isCorrect === false &&
    att.incorrectAnswers >= 1
  ) {
    const newCorrect = att.correctAnswers;
    const newScore = att.score;
    const newIncorrect = att.incorrectAnswers - 1;
    const newUnanswered = att.unansweredQuestions;
    const answeredScored = newCorrect + newIncorrect;
    const accuracy = answeredScored > 0 ? Math.round((newCorrect / answeredScored) * 100) : 0;
    const newAnswers = {
      ...att.userAnswers,
      11: {
        ...q11,
        isExcluded: true,
      },
    };

    return {
      ...att,
      maxScore: 49,
      excludedQuestions: 1,
      totalQuestions: totalQ,
      correctAnswers: newCorrect,
      incorrectAnswers: newIncorrect,
      unansweredQuestions: newUnanswered,
      score: newScore,
      accuracyPercentage: accuracy,
      userAnswers: newAnswers,
      isLegacyUnverified: false,
      legacyStatus: 'verified',
    };
  }

  // CASE C: Verified unanswered
  if (
    areCountsConsistent &&
    isScoreConsistent &&
    hasValidQ11Obj &&
    q11.isAnswered === false &&
    att.unansweredQuestions >= 1
  ) {
    const newCorrect = att.correctAnswers;
    const newScore = att.score;
    const newIncorrect = att.incorrectAnswers;
    const newUnanswered = att.unansweredQuestions - 1;
    const answeredScored = newCorrect + newIncorrect;
    const accuracy = answeredScored > 0 ? Math.round((newCorrect / answeredScored) * 100) : 0;
    const newAnswers = {
      ...att.userAnswers,
      11: {
        ...q11,
        isExcluded: true,
      },
    };

    return {
      ...att,
      maxScore: 49,
      excludedQuestions: 1,
      totalQuestions: totalQ,
      correctAnswers: newCorrect,
      incorrectAnswers: newIncorrect,
      unansweredQuestions: newUnanswered,
      score: newScore,
      accuracyPercentage: accuracy,
      userAnswers: newAnswers,
      isLegacyUnverified: false,
      legacyStatus: 'verified',
    };
  }

  // CASE D: Missing or incomplete Q11 record, malformed booleans, invalid counters, or inconsistent totals
  // NEVER guess or deduct without verified evidence!
  return {
    ...att,
    score: att.score,
    correctAnswers: att.correctAnswers,
    incorrectAnswers: att.incorrectAnswers,
    unansweredQuestions: att.unansweredQuestions,
    totalQuestions: totalQ,
    maxScore: att.maxScore || 50,
    excludedQuestions: att.excludedQuestions || 0,
    originalScore: att.score,
    isLegacyUnverified: true,
    legacyStatus: 'review_required',
    legacyNote:
      'Set 06 Question 11 historical response is missing or incomplete (original Question 11 response could not be verified). The original score and counters have been preserved without an unverified deduction.',
  };
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
  const activeExam = getActiveExamSync(setNumber);

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

// ----------------- ACTIVE EXAM & DURABLE PERSISTENCE (DEFECT 3) -----------------

// In-memory cache for active exams (supports fast sync access and fallback retention)
const memoryActiveExams = new Map<number, ActiveExamState>();

const WEB_LOCK_PREFIX = 'oir-exam-recovery-set-';
const LEASE_TIMEOUT_MS = 5000;
const IDB_DB_NAME = 'oir_hub_coordination';
const IDB_STORE_LEASES = 'leases';
const IDB_STORE_ACTIVE_EXAMS = 'active_exams';
const IDB_VERSION = 2;

/**
 * Open or initialize coordination IndexedDB database with leases and active_exams stores.
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
        if (!db.objectStoreNames.contains(IDB_STORE_LEASES)) {
          db.createObjectStore(IDB_STORE_LEASES, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_ACTIVE_EXAMS)) {
          db.createObjectStore(IDB_STORE_ACTIVE_EXAMS, { keyPath: 'setNumber' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB database'));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Persist active examination state into IndexedDB as durable fallback.
 */
function saveActiveExamToIdb(state: ActiveExamState): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const db = await openCoordinationDb();
      let putSuccess = false;
      const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      const req = store.put({
        setNumber: state.setNumber,
        state,
        updatedAt: Date.now(),
      });
      req.onsuccess = () => {
        putSuccess = true;
      };
      req.onerror = () => {
        putSuccess = false;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(putSuccess);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

/**
 * Retrieve active examination state from IndexedDB.
 */
function getActiveExamFromIdb(setNumber: number): Promise<ActiveExamState | null> {
  return new Promise(async (resolve) => {
    try {
      const db = await openCoordinationDb();
      const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readonly');
      const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      const req = store.get(setNumber);
      req.onsuccess = () => {
        const result = req.result;
        resolve(result?.state || null);
      };
      req.onerror = () => {
        resolve(null);
      };
      tx.oncomplete = () => {
        db.close();
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Remove active examination state from IndexedDB.
 */
function clearActiveExamFromIdb(setNumber: number): Promise<void> {
  return new Promise(async (resolve) => {
    try {
      const db = await openCoordinationDb();
      const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      store.delete(setNumber);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

/**
 * Synchronous check for active examination from localStorage and memory cache.
 */
export function getActiveExamSync(setNumber: number): ActiveExamState | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_EXAM_PREFIX}${setNumber}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.setNumber === 'number') {
        memoryActiveExams.set(setNumber, parsed);
        return parsed;
      }
    }
  } catch {
    // If localStorage read fails, fallback to memory cache
  }
  return memoryActiveExams.get(setNumber) || null;
}

/**
 * Asynchronously retrieve active examination state with durable IndexedDB fallback.
 */
export async function getActiveExam(setNumber: number): Promise<ActiveExamState | null> {
  const sync = getActiveExamSync(setNumber);
  if (sync) return sync;

  try {
    const fromIdb = await getActiveExamFromIdb(setNumber);
    if (fromIdb) {
      memoryActiveExams.set(setNumber, fromIdb);
      return fromIdb;
    }
  } catch {
    // Ignore IDB read error
  }
  return null;
}

/**
 * Defect 3: Active examination persistence with read-back verification and durable IndexedDB fallback.
 * Never silently reports success when browser storage fails.
 */
export async function saveActiveExam(state: ActiveExamState): Promise<ActiveExamSaveResult> {
  // Always preserve latest state in memory cache
  memoryActiveExams.set(state.setNumber, state);

  // 1. Attempt primary persistence: localStorage
  let localSuccess = false;
  try {
    const key = `${ACTIVE_EXAM_PREFIX}${state.setNumber}`;
    localStorage.setItem(key, JSON.stringify(state));

    // Read-back verification
    const readBack = localStorage.getItem(key);
    if (readBack) {
      const parsed = JSON.parse(readBack);
      if (
        parsed &&
        parsed.setNumber === state.setNumber &&
        parsed.examEndTime === state.examEndTime &&
        parsed.currentQuestionIndex === state.currentQuestionIndex &&
        parsed.userAnswers !== undefined &&
        parsed.questionTimeLeft !== undefined
      ) {
        localSuccess = true;
      }
    }
  } catch {
    localSuccess = false;
  }

  if (localSuccess) {
    return { success: true, storageType: 'localStorage' };
  }

  // 2. Attempt durable fallback: IndexedDB
  try {
    const idbSuccess = await saveActiveExamToIdb(state);
    if (idbSuccess) {
      // Read-back verification from IndexedDB
      const readBackIdb = await getActiveExamFromIdb(state.setNumber);
      if (
        readBackIdb &&
        readBackIdb.setNumber === state.setNumber &&
        readBackIdb.examEndTime === state.examEndTime &&
        readBackIdb.currentQuestionIndex === state.currentQuestionIndex &&
        readBackIdb.userAnswers !== undefined &&
        readBackIdb.questionTimeLeft !== undefined
      ) {
        return { success: true, storageType: 'indexedDB' };
      }
    }
  } catch {
    // Fall through to failure
  }

  // 3. Both persistence layers failed
  return {
    success: false,
    error: 'Both localStorage and IndexedDB failed to persist active examination state.',
  };
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
  memoryActiveExams.delete(setNumber);
  clearActiveExamFromIdb(setNumber).catch(() => {});
}

// ----------------- CROSS-TAB RECOVERY COORDINATION (DEFECT 4 & DEFECT 5) -----------------

/**
 * Atomically inspects and claims a recovery lease in an IndexedDB readwrite transaction.
 * Defect 4: Reports success ONLY after transaction.oncomplete commits!
 */
export async function acquireIdbLease(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS
): Promise<boolean> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      let isAcquired = false;
      const tx = db.transaction(IDB_STORE_LEASES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_LEASES);
      const key = `set_${setNumber}`;
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        const now = Date.now();
        if (existing && existing.expiresAt > now && existing.ownerId !== ownerId) {
          // Actively held by another tab/process
          isAcquired = false;
          return;
        }
        // Claim or renew lease in this transaction
        const putReq = store.put({ key, setNumber, ownerId, expiresAt: now + ttlMs });
        putReq.onsuccess = () => {
          isAcquired = true;
        };
        putReq.onerror = () => {
          isAcquired = false;
        };
      };
      getReq.onerror = () => {
        isAcquired = false;
      };

      tx.oncomplete = () => {
        db.close();
        resolve(isAcquired);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

/**
 * Releases lease only if currently owned by the caller.
 * Defect 4: Resolves only on transaction.oncomplete.
 */
export async function releaseIdbLease(setNumber: number, ownerId: string): Promise<void> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_LEASES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_LEASES);
      const key = `set_${setNumber}`;
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && existing.ownerId === ownerId) {
          store.delete(key);
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
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
 * Primary: Web Locks API (`navigator.locks.request` with `ifAvailable: true`).
 * Fallback: Transactional IndexedDB Lease with owner token & TTL.
 * Fail-safe: Fails safely with status code if no reliable locking primitive is available.
 */
export async function withRecoveryLock<T>(
  setNumber: number,
  callback: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false; error: 'recovery_in_progress' | 'lock_unavailable' }> {
  // 1. PRIMARY MECHANISM: Web Locks API
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      const lockName = `${WEB_LOCK_PREFIX}${setNumber}`;
      let lockExecuted = false;
      let execResult: T;
      let lockUnavailable = false;

      await navigator.locks.request(
        lockName,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            lockUnavailable = true;
            return;
          }
          lockExecuted = true;
          execResult = await callback();
        }
      );

      if (lockUnavailable) {
        return { acquired: false, error: 'recovery_in_progress' };
      }
      if (lockExecuted) {
        return { acquired: true, result: execResult! };
      }
    } catch {
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
        error: 'recovery_in_progress',
      };
    }
    try {
      const result = await callback();
      return { acquired: true, result };
    } finally {
      await releaseIdbLease(setNumber, ownerId);
    }
  }

  // 3. FAIL-SAFE:
  return {
    acquired: false,
    error: 'lock_unavailable',
  };
}

/**
 * Defect 5: Broadcast structured recovery message via BroadcastChannel and native storage event fallback.
 */
export function notifyRecoveryComplete(setNumber: number, attemptId: string): void {
  const message: RecoveryBroadcastMessage = {
    type: 'EXAM_RECOVERED',
    setNumber,
    attemptId,
    timestamp: Date.now(),
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('oir_recovery_channel');
      channel.postMessage(message);
      channel.close();
    } catch {
      // Ignore
    }
  }

  // Fallback for cross-tab storage event
  try {
    localStorage.setItem('oir_recovery_sync_event', JSON.stringify(message));
  } catch {
    // Ignore
  }
}

/**
 * Reliable Asynchronous Expired Exam Recovery with Cross-Tab Coordination.
 * - Idempotently checks if the attempt is already in permanent history.
 * - Coordinates via exclusive Web Locks API (with transactional IndexedDB fallback).
 * - Preserves original exam deadline (activeExam.examEndTime) as attempt timestamp.
 * - Clears active exam ONLY after successful, verified persistence to permanent storage.
 * - Returns structured RecoveryResult.
 */
export async function checkAndRecoverExpiredExam(
  setNumber: number,
  questions: Question[],
  settings: UserSettings
): Promise<RecoveryResult> {
  const activeExam = await getActiveExam(setNumber);
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

    if (lockResult.error === 'recovery_in_progress') {
      return {
        status: 'recovery_in_progress',
      };
    }

    return {
      status: 'lock_unavailable',
      setNumber,
      message: `Could not acquire exclusive recovery lock for Set ${setNumber}`,
    };
  }

  return lockResult.result;
}

export function clearAllUserData(): void {
  localStorage.removeItem(ATTEMPTS_KEY);
  memoryActiveExams.clear();
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
