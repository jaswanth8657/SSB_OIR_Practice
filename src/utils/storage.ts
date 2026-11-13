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
  VersionedActiveExamRecord,
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

  // Helper for Case D: mark review_required
  const markReviewRequired = (reason: string): TestAttempt => {
    return {
      ...att,
      score: att.score,
      correctAnswers: att.correctAnswers,
      incorrectAnswers: att.incorrectAnswers,
      unansweredQuestions: att.unansweredQuestions,
      totalQuestions: att.totalQuestions,
      maxScore: att.maxScore || 50,
      excludedQuestions: att.excludedQuestions || 0,
      originalScore: att.score,
      isLegacyUnverified: true,
      legacyStatus: 'review_required',
      legacyNote: `Set 06 Question 11 historical response verification failed: ${reason} (original Question 11 response could not be verified). The original score and counters have been preserved without an unverified deduction.`,
    };
  };

  // Validate totalQuestions: strictly require 50 for legacy unnormalized attempts!
  if (att.totalQuestions !== 50) {
    return markReviewRequired(`totalQuestions is ${att.totalQuestions}, expected 50`);
  }

  // Validate aggregate counters: must be finite, non-negative integers
  if (!Number.isInteger(att.score) || att.score < 0) {
    return markReviewRequired(`score is invalid or not an integer (${att.score})`);
  }
  if (!Number.isInteger(att.correctAnswers) || att.correctAnswers < 0) {
    return markReviewRequired(`correctAnswers is invalid or not an integer (${att.correctAnswers})`);
  }
  if (!Number.isInteger(att.incorrectAnswers) || att.incorrectAnswers < 0) {
    return markReviewRequired(`incorrectAnswers is invalid or not an integer (${att.incorrectAnswers})`);
  }
  if (!Number.isInteger(att.unansweredQuestions) || att.unansweredQuestions < 0) {
    return markReviewRequired(`unansweredQuestions is invalid or not an integer (${att.unansweredQuestions})`);
  }

  // Check aggregate totals consistency: correct + incorrect + unanswered === 50
  if (att.correctAnswers + att.incorrectAnswers + att.unansweredQuestions !== 50) {
    return markReviewRequired(
      `Counts sum mismatch: correct (${att.correctAnswers}) + incorrect (${att.incorrectAnswers}) + unanswered (${att.unansweredQuestions}) !== 50`
    );
  }

  // Check score matches correctAnswers
  if (att.score !== att.correctAnswers) {
    return markReviewRequired(`Score (${att.score}) does not match correctAnswers (${att.correctAnswers})`);
  }

  // Inspect Q11 record
  if (!att.userAnswers || typeof att.userAnswers !== 'object') {
    return markReviewRequired('userAnswers is missing or not an object');
  }
  const q11 = att.userAnswers[11];
  if (!q11 || typeof q11 !== 'object' || Array.isArray(q11)) {
    return markReviewRequired('Question 11 answer record is missing or invalid');
  }
  if (q11.questionNumber !== 11) {
    return markReviewRequired(`Question 11 record has questionNumber ${q11.questionNumber}, expected 11`);
  }

  // Validate boolean types
  if (typeof q11.isAnswered !== 'boolean') {
    return markReviewRequired('Question 11 isAnswered is not a boolean');
  }
  if (q11.isCorrect !== undefined && typeof q11.isCorrect !== 'boolean') {
    return markReviewRequired('Question 11 isCorrect is present but not a boolean');
  }

  // Check contradictory flag: unanswered but marked correct!
  if (!q11.isAnswered && q11.isCorrect === true) {
    return markReviewRequired('Question 11 has contradictory flags: isAnswered is false but isCorrect is true');
  }

  // CASE A: Verified correct
  if (q11.isAnswered === true && q11.isCorrect === true) {
    if (att.correctAnswers < 1 || att.score < 1) {
      return markReviewRequired('Case A verified correct but correctAnswers or score < 1');
    }
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
      totalQuestions: 50,
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
  if (q11.isAnswered === true && q11.isCorrect === false) {
    if (att.incorrectAnswers < 1) {
      return markReviewRequired('Case B verified incorrect but incorrectAnswers < 1');
    }
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
      totalQuestions: 50,
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
  if (q11.isAnswered === false) {
    if (att.unansweredQuestions < 1) {
      return markReviewRequired('Case C verified unanswered but unansweredQuestions < 1');
    }
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
      totalQuestions: 50,
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

  return markReviewRequired('Question 11 does not match any valid normalization case');
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

// ----------------- ACTIVE EXAM & DURABLE PERSISTENCE (DEFECT 1, 2, 4, 5) -----------------

// In-memory cache for active exams, storing versioned envelopes
const memoryActiveExams = new Map<number, VersionedActiveExamRecord>();

// Per-set write serialization queue to eliminate async write race conditions
const writeQueues = new Map<number, Promise<any>>();

function queueWrite<T>(setNumber: number, task: () => Promise<T>): Promise<T> {
  const current = writeQueues.get(setNumber) || Promise.resolve();
  const next = current.then(task, task);
  writeQueues.set(setNumber, next);
  return next;
}

const WEB_LOCK_PREFIX = 'oir-exam-recovery-set-';
const LEASE_TIMEOUT_MS = 30000;
const LEASE_HEARTBEAT_MS = 10000;
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
 * Deep equality check comparing all critical examination fields:
 * setNumber, currentQuestionIndex, userAnswers (questionNumber, selectedOption,
 * twoPartAnswer, dropdownSelection, isAnswered, isCorrect, isExcluded, timeSpentSeconds),
 * questionTimeLeft, currentQuestionStartedAt, questionExpiredMap, examStartTime,
 * examEndTime, isPaused.
 */
export function isStateDeepEqual(a: ActiveExamState, b: ActiveExamState): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.setNumber !== b.setNumber) return false;
  if (a.currentQuestionIndex !== b.currentQuestionIndex) return false;
  if (a.currentQuestionStartedAt !== b.currentQuestionStartedAt) return false;
  if (a.examStartTime !== b.examStartTime) return false;
  if (a.examEndTime !== b.examEndTime) return false;
  if (Boolean(a.isPaused) !== Boolean(b.isPaused)) return false;

  // Compare questionTimeLeft: either number or Record<number, number>
  if (typeof a.questionTimeLeft === 'number' || typeof b.questionTimeLeft === 'number') {
    if (a.questionTimeLeft !== b.questionTimeLeft) return false;
  } else {
    const qtlA = (a.questionTimeLeft || {}) as Record<string, number>;
    const qtlB = (b.questionTimeLeft || {}) as Record<string, number>;
    const qtlKeysA = Object.keys(qtlA);
    const qtlKeysB = Object.keys(qtlB);
    if (qtlKeysA.length !== qtlKeysB.length) return false;
    for (const k of qtlKeysA) {
      if (Number(qtlA[k]) !== Number(qtlB[k])) return false;
    }
  }

  // Compare questionExpiredMap
  const expA = a.questionExpiredMap || {};
  const expB = b.questionExpiredMap || {};
  const expKeysA = Object.keys(expA);
  const expKeysB = Object.keys(expB);
  if (expKeysA.length !== expKeysB.length) return false;
  for (const k of expKeysA) {
    if (Boolean(expA[Number(k)]) !== Boolean(expB[Number(k)])) return false;
  }

  // Compare userAnswers
  const ansA = a.userAnswers || {};
  const ansB = b.userAnswers || {};
  const keysA = Object.keys(ansA);
  const keysB = Object.keys(ansB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const ua = ansA[Number(k)];
    const ub = ansB[Number(k)];
    if (!ua || !ub) return false;
    if (ua.questionNumber !== ub.questionNumber) return false;
    if (ua.isAnswered !== ub.isAnswered) return false;
    if (Boolean(ua.isCorrect) !== Boolean(ub.isCorrect)) return false;
    if (Boolean(ua.isExcluded) !== Boolean(ub.isExcluded)) return false;
    if (Number(ua.timeSpentSeconds || 0) !== Number(ub.timeSpentSeconds || 0)) return false;

    // selectedOption: string | string[]
    if (Array.isArray(ua.selectedOption) || Array.isArray(ub.selectedOption)) {
      if (!Array.isArray(ua.selectedOption) || !Array.isArray(ub.selectedOption)) return false;
      if (ua.selectedOption.length !== ub.selectedOption.length) return false;
      for (let i = 0; i < ua.selectedOption.length; i++) {
        if (ua.selectedOption[i] !== ub.selectedOption[i]) return false;
      }
    } else {
      if (ua.selectedOption !== ub.selectedOption) return false;
    }

    // twoPartAnswer
    if (Boolean(ua.twoPartAnswer) !== Boolean(ub.twoPartAnswer)) return false;
    if (ua.twoPartAnswer && ub.twoPartAnswer) {
      if (
        ua.twoPartAnswer[0] !== ub.twoPartAnswer[0] ||
        ua.twoPartAnswer[1] !== ub.twoPartAnswer[1]
      ) {
        return false;
      }
    }

    // dropdownSelection: string[] or object
    if (Boolean(ua.dropdownSelection) !== Boolean(ub.dropdownSelection)) return false;
    if (ua.dropdownSelection && ub.dropdownSelection) {
      if (Array.isArray(ua.dropdownSelection) || Array.isArray(ub.dropdownSelection)) {
        if (!Array.isArray(ua.dropdownSelection) || !Array.isArray(ub.dropdownSelection)) return false;
        if (ua.dropdownSelection.length !== ub.dropdownSelection.length) return false;
        for (let i = 0; i < ua.dropdownSelection.length; i++) {
          if (ua.dropdownSelection[i] !== ub.dropdownSelection[i]) return false;
        }
      } else {
        const dropA = ua.dropdownSelection as any;
        const dropB = ub.dropdownSelection as any;
        const dropKeysA = Object.keys(dropA);
        const dropKeysB = Object.keys(dropB);
        if (dropKeysA.length !== dropKeysB.length) return false;
        for (const dk of dropKeysA) {
          if (dropA[dk] !== dropB[dk]) return false;
        }
      }
    }
  }

  return true;
}

/**
 * Read versioned envelope from localStorage with legacy migration support.
 */
function readLocalActiveExamEnvelope(setNumber: number): VersionedActiveExamRecord | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_EXAM_PREFIX}${setNumber}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed) return null;

    if (typeof parsed.revision === 'number' && (parsed.state || parsed.isDeleted)) {
      return parsed as VersionedActiveExamRecord;
    }
    // Legacy migration
    if (typeof parsed.setNumber === 'number' && parsed.userAnswers) {
      return {
        setNumber: parsed.setNumber,
        revision: 1,
        updatedAt: parsed.currentQuestionStartedAt || parsed.examStartTime || Date.now(),
        state: parsed as ActiveExamState,
        storageVersion: 1,
        isDeleted: false,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Write versioned envelope to localStorage with read-back verification.
 */
function writeLocalActiveExamEnvelope(envelope: VersionedActiveExamRecord): boolean {
  try {
    const key = `${ACTIVE_EXAM_PREFIX}${envelope.setNumber}`;
    localStorage.setItem(key, JSON.stringify(envelope));
    const readBack = localStorage.getItem(key);
    if (!readBack) return false;
    const parsed = JSON.parse(readBack);
    if (!parsed || parsed.revision !== envelope.revision) return false;
    if (envelope.isDeleted) return parsed.isDeleted === true;
    return isStateDeepEqual(parsed.state, envelope.state);
  } catch {
    return false;
  }
}

/**
 * Read versioned envelope from IndexedDB.
 */
function readIdbActiveExamEnvelope(setNumber: number): Promise<VersionedActiveExamRecord | null> {
  return new Promise(async (resolve) => {
    try {
      const db = await openCoordinationDb();
      const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readonly');
      const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      const req = store.get(setNumber);
      req.onsuccess = () => {
        const res = req.result;
        if (!res) {
          resolve(null);
          return;
        }
        if (typeof res.revision === 'number' && (res.state || res.isDeleted)) {
          resolve(res as VersionedActiveExamRecord);
        } else if (res.state && typeof res.state.setNumber === 'number') {
          resolve({
            setNumber: res.state.setNumber,
            revision: 1,
            updatedAt: res.updatedAt || Date.now(),
            state: res.state,
            storageVersion: 1,
            isDeleted: false,
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Save versioned envelope to IndexedDB.
 */
function saveActiveExamEnvelopeToIdb(envelope: VersionedActiveExamRecord): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const db = await openCoordinationDb();
      let putSuccess = false;
      const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      const req = store.put(envelope);
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
 * Invalidate in-memory cache for a specific set number.
 */
export function invalidateActiveExamCache(setNumber: number): void {
  memoryActiveExams.delete(setNumber);
}

/**
 * Synchronous check for active examination from hydrated memory cache or valid localStorage envelope.
 */
export function getActiveExamSync(setNumber: number): ActiveExamState | null {
  const cached = memoryActiveExams.get(setNumber);
  if (cached) {
    if (cached.isDeleted) return null;
    return cached.state;
  }
  const localEnv = readLocalActiveExamEnvelope(setNumber);
  if (localEnv) {
    if (localEnv.isDeleted) return null;
    memoryActiveExams.set(setNumber, localEnv);
    return localEnv.state;
  }
  return null;
}

/**
 * Asynchronously retrieve active examination state with dual-store revision comparison
 * and automatic stale storage repair.
 */
export async function getActiveExam(setNumber: number): Promise<ActiveExamState | null> {
  const localEnv = readLocalActiveExamEnvelope(setNumber);
  const idbEnv = await readIdbActiveExamEnvelope(setNumber);

  let winner: VersionedActiveExamRecord | null = null;

  if (localEnv && idbEnv) {
    if (idbEnv.revision > localEnv.revision) {
      winner = idbEnv;
      // Stale localStorage detected: repair with newer IDB record
      writeLocalActiveExamEnvelope(idbEnv);
    } else if (localEnv.revision > idbEnv.revision) {
      winner = localEnv;
      // Stale IDB detected: repair with newer local record
      saveActiveExamEnvelopeToIdb(localEnv).catch(() => {});
    } else {
      // Revisions are equal, tiebreak with updatedAt
      if (idbEnv.updatedAt > localEnv.updatedAt) {
        winner = idbEnv;
        writeLocalActiveExamEnvelope(idbEnv);
      } else {
        winner = localEnv;
        saveActiveExamEnvelopeToIdb(localEnv).catch(() => {});
      }
    }
  } else if (idbEnv) {
    winner = idbEnv;
    writeLocalActiveExamEnvelope(idbEnv);
  } else if (localEnv) {
    winner = localEnv;
    saveActiveExamEnvelopeToIdb(localEnv).catch(() => {});
  }

  if (!winner || winner.isDeleted) {
    memoryActiveExams.delete(setNumber);
    return null;
  }

  memoryActiveExams.set(setNumber, winner);
  return winner.state;
}

/**
 * Startup hydration: asynchronously inspects and hydrates in-memory cache for all sets.
 */
export async function hydrateActiveExamCache(): Promise<void> {
  const promises: Promise<any>[] = [];
  for (let s = 1; s <= 20; s++) {
    promises.push(getActiveExam(s));
  }
  await Promise.all(promises);
}

/**
 * Save active examination state with serialized queue, monotonically increasing revision,
 * deep state verification, and dual-store fallback.
 */
export async function saveActiveExam(state: ActiveExamState): Promise<ActiveExamSaveResult> {
  // Determine monotonically increasing revision immediately
  let currentRev = 0;
  const cached = memoryActiveExams.get(state.setNumber);
  if (cached && typeof cached.revision === 'number') {
    currentRev = Math.max(currentRev, cached.revision);
  }
  const local = readLocalActiveExamEnvelope(state.setNumber);
  if (local && typeof local.revision === 'number') {
    currentRev = Math.max(currentRev, local.revision);
  }

  const nextRev = currentRev + 1;
  const envelope: VersionedActiveExamRecord = {
    setNumber: state.setNumber,
    revision: nextRev,
    updatedAt: Date.now(),
    state,
    storageVersion: 1,
    isDeleted: false,
  };

  // Immediate synchronous write to memory cache and localStorage so that synchronous
  // consumers (such as getSetProgress, getActiveExamSync) observe the updated state immediately
  const localSuccess = writeLocalActiveExamEnvelope(envelope);
  if (localSuccess) {
    memoryActiveExams.set(state.setNumber, envelope);
  }

  return queueWrite(state.setNumber, async () => {
    if (localSuccess) {
      // Asynchronously mirror to IndexedDB as durable fallback
      saveActiveExamEnvelopeToIdb(envelope).catch(() => {});
      return { success: true, storageType: 'localStorage' as const };
    }

    // 2. Durable fallback: IndexedDB
    try {
      const idbSuccess = await saveActiveExamEnvelopeToIdb(envelope);
      if (idbSuccess) {
        // Read-back verification from IDB
        const readBackIdb = await readIdbActiveExamEnvelope(state.setNumber);
        if (
          readBackIdb &&
          readBackIdb.revision === nextRev &&
          isStateDeepEqual(readBackIdb.state, state)
        ) {
          memoryActiveExams.set(state.setNumber, envelope);
          return { success: true, storageType: 'indexedDB' as const };
        }
      }
    } catch {
      // IDB failed
    }

    // 3. Both failed
    return {
      success: false,
      error: 'Both localStorage and IndexedDB failed to persist active examination state.',
    };
  });
}

/**
 * Safe clear of active exam: evicts memory cache, removes from localStorage,
 * and awaits IndexedDB deletion.
 */
export async function clearActiveExam(setNumber: number): Promise<void> {
  invalidateActiveExamCache(setNumber);
  try {
    localStorage.removeItem(`${ACTIVE_EXAM_PREFIX}${setNumber}`);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(`${SUBMISSION_GUARD_KEY}${setNumber}`);
    }
  } catch {
    // Ignore storage clear errors in headless environments
  }
  await clearActiveExamFromIdb(setNumber).catch(() => {});
}

// ----------------- CROSS-TAB RECOVERY COORDINATION & LEASES -----------------

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
      let isAcquired = false;
      const tx = db.transaction(IDB_STORE_LEASES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_LEASES);
      const key = `set_${setNumber}`;
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        const now = Date.now();
        if (existing && existing.expiresAt > now && existing.ownerId !== ownerId) {
          isAcquired = false;
          return;
        }
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
 * Renews an existing lease if still owned by the caller.
 */
export async function renewIdbLease(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS
): Promise<boolean> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      let renewed = false;
      const tx = db.transaction(IDB_STORE_LEASES, 'readwrite');
      const store = tx.objectStore(IDB_STORE_LEASES);
      const key = `set_${setNumber}`;
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && existing.ownerId === ownerId) {
          const now = Date.now();
          const putReq = store.put({ key, setNumber, ownerId, expiresAt: now + ttlMs });
          putReq.onsuccess = () => {
            renewed = true;
          };
          putReq.onerror = () => {
            renewed = false;
          };
        } else {
          renewed = false;
        }
      };
      getReq.onerror = () => {
        renewed = false;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(renewed);
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
 * Fallback: Transactional IndexedDB Lease with owner token, TTL, and heartbeat renewal.
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
      // Fall through to IndexedDB fallback
    }
  }

  // 2. FALLBACK MECHANISM: IndexedDB Transaction-based Lease with Heartbeat Renewal
  if (typeof indexedDB !== 'undefined') {
    const ownerId = `owner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const acquired = await acquireIdbLease(setNumber, ownerId, LEASE_TIMEOUT_MS);
    if (!acquired) {
      return {
        acquired: false,
        error: 'recovery_in_progress',
      };
    }

    let heartbeatTimer: any = null;
    let leaseLost = false;

    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await renewIdbLease(setNumber, ownerId, LEASE_TIMEOUT_MS);
        if (!renewed) {
          leaseLost = true;
        }
      } catch {
        leaseLost = true;
      }
    }, LEASE_HEARTBEAT_MS);

    try {
      const result = await callback();
      if (leaseLost) {
        return {
          acquired: false,
          error: 'recovery_in_progress',
        };
      }
      return { acquired: true, result };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
 * Broadcast structured recovery message via BroadcastChannel and native storage event fallback.
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
 */
export async function checkAndRecoverExpiredExam(
  setNumber: number,
  questions: Question[],
  settings: UserSettings
): Promise<RecoveryResult> {
  const activeExam = await getActiveExam(setNumber);
  if (!activeExam) {
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
  if (activeExam.examEndTime > now) {
    return { status: 'not_expired' };
  }

  const totalDurationMs = settings.totalDurationMinutes * 60 * 1000;
  const examSessionStart = activeExam.examStartTime || (activeExam.examEndTime - totalDurationMs);
  const stableAttemptId = `att_${setNumber}_${examSessionStart}`;

  const allAttempts = getAllAttempts();
  const existingAttempt = allAttempts.find((a) => a.attemptId === stableAttemptId);
  if (existingAttempt) {
    await clearActiveExam(setNumber);
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

  const lockResult = await withRecoveryLock(setNumber, async () => {
    const historyUnderLock = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (historyUnderLock) {
      await clearActiveExam(setNumber);
      return { status: 'already_recovered' as const, attempt: historyUnderLock };
    }

    const totalTimeSeconds = settings.totalDurationMinutes * 60;
    const attempt = buildTestAttempt(
      setNumber,
      questions,
      activeExam.userAnswers || {},
      totalTimeSeconds,
      stableAttemptId,
      activeExam.examEndTime
    );

    const saveResult = saveAttempt(attempt);
    if (!saveResult.success) {
      return {
        status: 'storage_error' as const,
        setNumber,
        message: saveResult.error || 'Failed to persist recovered examination',
      };
    }

    const verifiedAttempts = getAllAttempts();
    const isSaved = verifiedAttempts.some((a) => a.attemptId === stableAttemptId);
    if (!isSaved) {
      return {
        status: 'storage_error' as const,
        setNumber,
        message: 'Persistence verification failed: recovered attempt not confirmed in storage',
      };
    }

    // Await safe deletion of active exam
    await clearActiveExam(setNumber);

    try {
      localStorage.setItem(
        `oir_recent_recovery_${setNumber}`,
        JSON.stringify({ attemptId: stableAttemptId, expiresAt: Date.now() + 30000 })
      );
    } catch {
      // Ignore
    }

    notifyRecoveryComplete(setNumber, stableAttemptId);

    return { status: 'recovered' as const, attempt };
  });

  if (!lockResult.acquired) {
    const recheck = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (recheck) {
      await clearActiveExam(setNumber);
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
