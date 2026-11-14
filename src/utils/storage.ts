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
  ClearActiveExamResult,
  StartActiveExamSessionResult,
  IdbEnvelopeReadResult,
  CommitFencedRecoveryParams,
  CommitFencedRecoveryResult,
  RecoveryCheckpoint,
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

// Quarantined sets currently awaiting authoritative asynchronous hydration
const quarantinedSets = new Set<number>();

export function quarantineSetForHydration(setNumber: number): void {
  quarantinedSets.add(setNumber);
  memoryActiveExams.delete(setNumber);
}

export function isSetQuarantined(setNumber: number): boolean {
  return quarantinedSets.has(setNumber);
}

export function releaseSetQuarantine(setNumber: number): void {
  quarantinedSets.delete(setNumber);
}

// Per-set write serialization queue to eliminate async write race conditions in this context
const writeQueues = new Map<number, Promise<any>>();

export function queueWrite<T>(setNumber: number, task: () => Promise<T>): Promise<T> {
  const current = writeQueues.get(setNumber) || Promise.resolve();
  const next = current.then(task, task);
  writeQueues.set(setNumber, next);
  return next;
}

const WEB_LOCK_PREFIX = 'oir-exam-recovery-set-';
const LEASE_TIMEOUT_MS = 30000;
const LEASE_HEARTBEAT_MS = 10000;
export const IDB_DB_NAME = 'oir_hub_coordination';
export const IDB_STORE_LEASES = 'leases';
export const IDB_STORE_ACTIVE_EXAMS = 'active_exams';
export const IDB_STORE_FENCE_COUNTERS = 'fence_counters';
export const IDB_STORE_RECOVERED_ATTEMPTS = 'recovered_attempts';
export const IDB_VERSION = 3;

/**
 * Open or initialize coordination IndexedDB database with leases, active_exams,
 * fence_counters, and recovered_attempts stores.
 */
export function openCoordinationDb(): Promise<IDBDatabase> {
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
        if (!db.objectStoreNames.contains(IDB_STORE_FENCE_COUNTERS)) {
          db.createObjectStore(IDB_STORE_FENCE_COUNTERS, { keyPath: 'setNumber' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_RECOVERED_ATTEMPTS)) {
          db.createObjectStore(IDB_STORE_RECOVERED_ATTEMPTS, { keyPath: 'attemptId' });
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
 * Strict canonical deep equality comparison without coercion.
 * Distinguishes missing properties from explicit undefined/false/null/0,
 * respects exact type matches, array ordering, and key presence.
 */
export function strictDeepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }
  // Check if both are NaN
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }

  // Type mismatch
  if (typeof a !== typeof b) {
    return false;
  }

  // If either is null or undefined (and not identical via ===)
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }

  // Array comparison
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr || bIsArr) {
    if (!aIsArr || !bIsArr) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!strictDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Object comparison
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!strictDeepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Canonical deep equality check for ActiveExamState without coercion.
 */
export function isStateDeepEqual(a: ActiveExamState, b: ActiveExamState): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return strictDeepEqual(a, b);
}

/**
 * Shared storage envelope validator.
 * Rejects corrupt, partial, or malformed records.
 */
export function validateStorageEnvelope(raw: unknown): VersionedActiveExamRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, any>;

  // Schema version must be 1
  if (obj.storageVersion !== 1) return null;

  // setNumber must be an integer 1..20
  if (!Number.isInteger(obj.setNumber) || obj.setNumber < 1 || obj.setNumber > 20) return null;

  // revision must be a positive integer
  if (!Number.isInteger(obj.revision) || obj.revision <= 0) return null;

  // updatedAt must be finite positive timestamp
  if (typeof obj.updatedAt !== 'number' || !Number.isFinite(obj.updatedAt) || obj.updatedAt <= 0) return null;

  // isDeleted: boolean if present, defaults to false for active v1 records
  if (obj.isDeleted !== undefined && typeof obj.isDeleted !== 'boolean') return null;
  const isDeleted = obj.isDeleted === true;

  // sessionId: strictly non-empty string for valid versioned envelopes
  if (typeof obj.sessionId !== 'string' || !obj.sessionId.trim()) return null;
  const sessionId = obj.sessionId.trim();

  // Tombstone envelope
  if (isDeleted) {
    // Tombstones must not carry an active state object
    if (obj.state !== undefined && obj.state !== null) return null;
    return {
      setNumber: obj.setNumber,
      revision: obj.revision,
      updatedAt: obj.updatedAt,
      sessionId,
      storageVersion: 1,
      isDeleted: true,
      state: undefined,
    };
  }

  // Active record: state must exist
  const state = obj.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;

  // state.setNumber must match envelope.setNumber
  if (state.setNumber !== obj.setNumber) return null;

  // state.sessionId if present must match envelope sessionId
  if (state.sessionId && state.sessionId !== sessionId) return null;

  // state.currentQuestionIndex must be integer 0..49
  if (!Number.isInteger(state.currentQuestionIndex) || state.currentQuestionIndex < 0 || state.currentQuestionIndex > 49) return null;

  // Timestamps must be finite numbers > 0
  if (typeof state.examStartTime !== 'number' || !Number.isFinite(state.examStartTime) || state.examStartTime <= 0) return null;
  if (typeof state.examEndTime !== 'number' || !Number.isFinite(state.examEndTime) || state.examEndTime <= 0) return null;

  // userAnswers must be an object
  if (!state.userAnswers || typeof state.userAnswers !== 'object' || Array.isArray(state.userAnswers)) return null;
  for (const [k, ans] of Object.entries(state.userAnswers)) {
    const qNum = Number(k);
    if (!Number.isInteger(qNum) || qNum < 1 || qNum > 50) return null;
    if (!ans || typeof ans !== 'object' || Array.isArray(ans)) return null;
    const ansObj = ans as Record<string, any>;
    if (ansObj.questionNumber !== qNum) return null;
    if (typeof ansObj.isAnswered !== 'boolean') return null;
  }

  // questionExpiredMap
  if (state.questionExpiredMap !== undefined) {
    if (typeof state.questionExpiredMap !== 'object' || Array.isArray(state.questionExpiredMap)) return null;
    for (const [k, v] of Object.entries(state.questionExpiredMap)) {
      const qNum = Number(k);
      if (!Number.isInteger(qNum) || qNum < 1 || qNum > 50) return null;
      if (typeof v !== 'boolean') return null;
    }
  }

  // questionTimeLeft
  if (state.questionTimeLeft !== undefined) {
    if (typeof state.questionTimeLeft === 'number') {
      if (!Number.isFinite(state.questionTimeLeft)) return null;
    } else if (typeof state.questionTimeLeft === 'object' && !Array.isArray(state.questionTimeLeft)) {
      for (const [k, v] of Object.entries(state.questionTimeLeft)) {
        const qNum = Number(k);
        if (!Number.isInteger(qNum) || qNum < 1 || qNum > 50) return null;
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      }
    } else {
      return null;
    }
  }

  return {
    setNumber: obj.setNumber,
    revision: obj.revision,
    updatedAt: obj.updatedAt,
    sessionId,
    storageVersion: 1,
    isDeleted: false,
    state,
  };
}

/**
 * Explicit, safe migration for legacy unversioned active exam records and older versioned envelopes without sessionId.
 * Strictly rejects corrupted envelopes.
 */
export function migrateLegacyActiveExam(raw: unknown): VersionedActiveExamRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, any>;

  // Older versioned envelope without sessionId (Pass 5 / early records)
  if ('storageVersion' in obj || 'revision' in obj || 'isDeleted' in obj) {
    if (obj.storageVersion !== 1 && obj.storageVersion !== undefined) return null;
    if (obj.isDeleted === true) return null; // Corrupted tombstone without sessionId cannot be migrated to active state
    if (!obj.state || typeof obj.state !== 'object' || Array.isArray(obj.state)) return null;
    if (!Number.isInteger(obj.setNumber) || obj.setNumber < 1 || obj.setNumber > 20) return null;
    if (!Number.isInteger(obj.revision) || obj.revision <= 0) return null;

    const state = obj.state as Record<string, any>;
    if (!Number.isInteger(state.setNumber) || state.setNumber !== obj.setNumber) return null;
    if (!Number.isInteger(state.currentQuestionIndex) || state.currentQuestionIndex < 0 || state.currentQuestionIndex > 49) return null;
    if (!state.userAnswers || typeof state.userAnswers !== 'object' || Array.isArray(state.userAnswers)) return null;

    const deterministicSessionId =
      typeof obj.sessionId === 'string' && obj.sessionId.trim()
        ? obj.sessionId.trim()
        : `sess_${obj.setNumber}_${obj.updatedAt || state.examStartTime || Date.now()}_legacy`;

    return {
      setNumber: obj.setNumber,
      revision: obj.revision,
      updatedAt: obj.updatedAt || state.currentQuestionStartedAt || Date.now(),
      sessionId: deterministicSessionId,
      storageVersion: 1,
      isDeleted: false,
      state: { ...(state as ActiveExamState), sessionId: deterministicSessionId },
    };
  }

  // Pure legacy unversioned ActiveExamState
  if (!Number.isInteger(obj.setNumber) || obj.setNumber < 1 || obj.setNumber > 20) return null;
  if (!Number.isInteger(obj.currentQuestionIndex) || obj.currentQuestionIndex < 0 || obj.currentQuestionIndex > 49) return null;
  if (!obj.userAnswers || typeof obj.userAnswers !== 'object' || Array.isArray(obj.userAnswers)) return null;

  const sessionId = `sess_${obj.setNumber}_${obj.examStartTime || Date.now()}_legacy`;
  const state: ActiveExamState = { ...(obj as ActiveExamState), sessionId };
  return {
    setNumber: obj.setNumber,
    revision: 1,
    updatedAt: obj.currentQuestionStartedAt || obj.examStartTime || Date.now(),
    sessionId,
    storageVersion: 1,
    isDeleted: false,
    state,
  };
}

/**
 * Validates envelope or applies safe legacy migration.
 */
export function parseEnvelopeOrMigrate(raw: unknown): VersionedActiveExamRecord | null {
  const validated = validateStorageEnvelope(raw);
  if (validated) return validated;
  return migrateLegacyActiveExam(raw);
}

/**
 * Read versioned envelope from localStorage with validation and legacy migration.
 */
export function readLocalActiveExamEnvelope(setNumber: number): VersionedActiveExamRecord | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_EXAM_PREFIX}${setNumber}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parseEnvelopeOrMigrate(parsed);
  } catch {
    return null;
  }
}

/**
 * Write versioned envelope to localStorage with read-back verification.
 */
export function writeLocalActiveExamEnvelope(envelope: VersionedActiveExamRecord): boolean {
  try {
    const key = `${ACTIVE_EXAM_PREFIX}${envelope.setNumber}`;
    localStorage.setItem(key, JSON.stringify(envelope));
    const readBackRaw = localStorage.getItem(key);
    if (!readBackRaw) return false;
    const parsed = JSON.parse(readBackRaw);
    const readBack = validateStorageEnvelope(parsed);
    if (!readBack || readBack.revision !== envelope.revision || readBack.sessionId !== envelope.sessionId) {
      return false;
    }
    if (envelope.isDeleted) {
      return readBack.isDeleted === true;
    }
    return Boolean(readBack.state && envelope.state && isStateDeepEqual(readBack.state, envelope.state));
  } catch {
    return false;
  }
}

/**
 * Authoritatively read versioned envelope from IndexedDB with typed status.
 * Distinguishes 'found', 'absent', 'unsupported', and 'error' so callers can fail closed.
 */
export function readIdbActiveExamEnvelopeDetailed(setNumber: number): Promise<IdbEnvelopeReadResult> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      return resolve({ status: 'unsupported' });
    }
    openCoordinationDb()
      .then((db) => {
        try {
          const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readonly');
          const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
          const req = store.get(setNumber);
          req.onsuccess = () => {
            if (req.result === undefined) {
              resolve({ status: 'absent' });
              return;
            }
            const validated = parseEnvelopeOrMigrate(req.result);
            if (validated) {
              resolve({ status: 'found', envelope: validated });
            } else {
              resolve({ status: 'error', error: 'Corrupt active exam envelope in IndexedDB' });
            }
          };
          req.onerror = () => {
            resolve({ status: 'error', error: req.error?.message || 'IndexedDB get failed' });
          };
          tx.oncomplete = () => db.close();
          tx.onerror = () => {
            db.close();
            resolve({ status: 'error', error: tx.error?.message || 'IndexedDB transaction failed' });
          };
          tx.onabort = () => {
            db.close();
            resolve({ status: 'error', error: 'IndexedDB transaction aborted' });
          };
        } catch (err: any) {
          db.close();
          resolve({ status: 'error', error: err?.message || 'IndexedDB transaction creation failed' });
        }
      })
      .catch((err: any) => {
        resolve({ status: 'error', error: err?.message || 'Failed to open IndexedDB' });
      });
  });
}

/**
 * Read versioned envelope from IndexedDB.
 */
export async function readIdbActiveExamEnvelope(setNumber: number): Promise<VersionedActiveExamRecord | null> {
  const res = await readIdbActiveExamEnvelopeDetailed(setNumber);
  if (res.status === 'found' && res.envelope) {
    return res.envelope;
  }
  return null;
}

/**
 * Invalidate in-memory cache for a specific set number.
 */
export function invalidateActiveExamCache(setNumber: number): void {
  memoryActiveExams.delete(setNumber);
}

/**
 * Synchronous check for active examination from hydrated memory cache or valid localStorage envelope.
 * Returns null if the set is quarantined for hydration or marked deleted.
 */
export function getActiveExamSync(setNumber: number): ActiveExamState | null {
  if (quarantinedSets.has(setNumber)) {
    return null;
  }
  const cached = memoryActiveExams.get(setNumber);
  if (cached) {
    if (cached.isDeleted) return null;
    return cached.state || null;
  }
  const localEnv = readLocalActiveExamEnvelope(setNumber);
  if (localEnv) {
    if (localEnv.isDeleted) return null;
    memoryActiveExams.set(setNumber, localEnv);
    return localEnv.state || null;
  }
  return null;
}

/**
 * Asynchronously retrieve active examination state with dual-store revision comparison,
 * fail-closed IndexedDB protection, and awaited replica repair. Releases quarantine upon completion.
 */
export async function getActiveExam(setNumber: number): Promise<ActiveExamState | null> {
  const idbReadRes = await readIdbActiveExamEnvelopeDetailed(setNumber);

  // FAIL-CLOSED: If IndexedDB is supported but returns an error, do NOT fall back to localStorage
  if (idbReadRes.status === 'error') {
    releaseSetQuarantine(setNumber);
    return null;
  }

  const localEnv = readLocalActiveExamEnvelope(setNumber);
  let idbEnv: VersionedActiveExamRecord | null = null;
  if (idbReadRes.status === 'found' && idbReadRes.envelope) {
    idbEnv = idbReadRes.envelope;
  }

  let winner: VersionedActiveExamRecord | null = null;

  if (localEnv && idbEnv) {
    if (idbEnv.revision > localEnv.revision) {
      winner = idbEnv;
      // Stale localStorage detected: repair with newer IDB record
      writeLocalActiveExamEnvelope(idbEnv);
    } else if (localEnv.revision > idbEnv.revision) {
      winner = localEnv;
      // Stale IDB detected: repair with newer local record inside awaited IDB transaction
      if (typeof indexedDB !== 'undefined') {
        try {
          const db = await openCoordinationDb();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
            tx.objectStore(IDB_STORE_ACTIVE_EXAMS).put(localEnv);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
            tx.onabort = () => {
              db.close();
              reject(new Error('Tx aborted'));
            };
          });
        } catch {
          // Ignore background repair failure
        }
      }
    } else {
      // Revisions are equal, tiebreak with updatedAt
      if (idbEnv.updatedAt >= localEnv.updatedAt) {
        winner = idbEnv;
        writeLocalActiveExamEnvelope(idbEnv);
      } else {
        winner = localEnv;
        if (typeof indexedDB !== 'undefined') {
          try {
            const db = await openCoordinationDb();
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
              tx.objectStore(IDB_STORE_ACTIVE_EXAMS).put(localEnv);
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(tx.error);
              };
              tx.onabort = () => {
                db.close();
                reject(new Error('Tx aborted'));
              };
            });
          } catch {
            // Ignore
          }
        }
      }
    }
  } else if (idbEnv) {
    winner = idbEnv;
    writeLocalActiveExamEnvelope(idbEnv);
  } else if (localEnv) {
    if (idbReadRes.status === 'absent' && typeof indexedDB !== 'undefined') {
      // IDB was queried and returned absent, but localEnv exists. Repair IDB authoritatively.
      winner = localEnv;
      try {
        const db = await openCoordinationDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
          tx.objectStore(IDB_STORE_ACTIVE_EXAMS).put(localEnv);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Tx aborted'));
          };
        });
      } catch {
        // Ignore
      }
    } else {
      winner = localEnv;
    }
  }

  // Release any quarantine for this set
  releaseSetQuarantine(setNumber);

  if (!winner || winner.isDeleted) {
    if (winner) {
      memoryActiveExams.set(setNumber, winner);
    } else {
      memoryActiveExams.delete(setNumber);
    }
    return null;
  }

  memoryActiveExams.set(setNumber, winner);
  return winner.state || null;
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
 * Explicit, authorized creation or restart of an active examination session.
 * This is the ONLY authorized mechanism to replace an existing session or start a new retake/exam.
 * Supports compare-and-set via expectedPreviousSessionId.
 */
export async function startActiveExamSession(
  setNumber: number,
  newSessionId: string,
  initialState: ActiveExamState,
  expectedPreviousSessionId?: string
): Promise<StartActiveExamSessionResult> {
  if (!newSessionId || typeof newSessionId !== 'string' || !newSessionId.trim()) {
    return { success: false, error: 'Cannot start active exam session: valid newSessionId is required' };
  }

  const cleanSessionId = newSessionId.trim();
  const stateSnapshot: ActiveExamState = JSON.parse(JSON.stringify(initialState));
  stateSnapshot.setNumber = setNumber;
  stateSnapshot.sessionId = cleanSessionId;

  return queueWrite(setNumber, async () => {
    // 1. Authoritative write to IndexedDB
    if (typeof indexedDB !== 'undefined') {
      try {
        const idbResult = await new Promise<{ success: boolean; envelope?: VersionedActiveExamRecord; error?: string }>(
          async (resolve) => {
            try {
              const db = await openCoordinationDb();
              const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
              const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
              const getReq = store.get(setNumber);

              let committedEnvelope: VersionedActiveExamRecord | null = null;
              let rejectReason: string | null = null;

              getReq.onsuccess = () => {
                const existing = parseEnvelopeOrMigrate(getReq.result);

                // Idempotency: if already started and active with cleanSessionId
                if (existing && !existing.isDeleted && existing.sessionId === cleanSessionId) {
                  committedEnvelope = existing;
                  return;
                }

                // If expectedPreviousSessionId was specified, verify match
                if (expectedPreviousSessionId !== undefined && existing) {
                  if (existing.sessionId !== expectedPreviousSessionId) {
                    rejectReason = `Cannot start new exam session: expected previous session ${expectedPreviousSessionId} but found ${existing.sessionId}`;
                    return;
                  }
                }

                // Check localStorage revision
                const localEnv = readLocalActiveExamEnvelope(setNumber);
                let currentMaxRev = existing ? existing.revision : 0;
                if (localEnv && localEnv.revision > currentMaxRev) {
                  currentMaxRev = localEnv.revision;
                }

                const nextRev = currentMaxRev + 1;
                committedEnvelope = {
                  setNumber,
                  revision: nextRev,
                  updatedAt: Date.now(),
                  sessionId: cleanSessionId,
                  storageVersion: 1,
                  isDeleted: false,
                  state: stateSnapshot,
                };

                const putReq = store.put(committedEnvelope);
                putReq.onerror = () => {
                  rejectReason = putReq.error?.message || 'IndexedDB store put failed';
                };
              };

              getReq.onerror = () => {
                rejectReason = getReq.error?.message || 'IndexedDB store get failed';
              };

              tx.oncomplete = () => {
                db.close();
                if (rejectReason) {
                  resolve({ success: false, error: rejectReason });
                  return;
                }
                if (!committedEnvelope) {
                  resolve({ success: false, error: 'Transaction completed without commit' });
                  return;
                }
                resolve({ success: true, envelope: committedEnvelope });
              };

              tx.onerror = () => {
                db.close();
                resolve({ success: false, error: tx.error?.message || 'IndexedDB transaction failed' });
              };

              tx.onabort = () => {
                db.close();
                resolve({ success: false, error: 'IndexedDB transaction aborted' });
              };
            } catch (err: any) {
              resolve({ success: false, error: err?.message || 'Failed to open IndexedDB' });
            }
          }
        );

        if (idbResult.success && idbResult.envelope) {
          // Read-back verification from IDB
          const readBack = await readIdbActiveExamEnvelope(setNumber);
          if (
            readBack &&
            readBack.revision === idbResult.envelope.revision &&
            readBack.sessionId === cleanSessionId &&
            !readBack.isDeleted
          ) {
            writeLocalActiveExamEnvelope(idbResult.envelope);
            memoryActiveExams.set(setNumber, idbResult.envelope);
            releaseSetQuarantine(setNumber);
            return { success: true, envelope: idbResult.envelope };
          } else {
            return { success: false, error: 'IndexedDB read-back verification failed for new session' };
          }
        } else if (idbResult.error) {
          return { success: false, error: idbResult.error };
        }
      } catch (err: any) {
        // Fall through to localStorage
      }
    }

    // 2. Fallback: localStorage
    try {
      const localExisting = readLocalActiveExamEnvelope(setNumber);
      if (localExisting && !localExisting.isDeleted && localExisting.sessionId === cleanSessionId) {
        memoryActiveExams.set(setNumber, localExisting);
        releaseSetQuarantine(setNumber);
        return { success: true, envelope: localExisting };
      }

      if (expectedPreviousSessionId !== undefined && localExisting) {
        if (localExisting.sessionId !== expectedPreviousSessionId) {
          return {
            success: false,
            error: `Cannot start new exam session: expected previous session ${expectedPreviousSessionId} but found ${localExisting.sessionId}`,
          };
        }
      }

      const nextRev = (localExisting?.revision || 0) + 1;
      const envelope: VersionedActiveExamRecord = {
        setNumber,
        revision: nextRev,
        updatedAt: Date.now(),
        sessionId: cleanSessionId,
        storageVersion: 1,
        isDeleted: false,
        state: stateSnapshot,
      };

      const localSuccess = writeLocalActiveExamEnvelope(envelope);
      if (localSuccess) {
        memoryActiveExams.set(setNumber, envelope);
        releaseSetQuarantine(setNumber);
        return { success: true, envelope };
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'LocalStorage failed to persist new session' };
    }

    return { success: false, error: 'Failed to persist new active examination session' };
  });
}

/**
 * Save active examination state with state snapshotting, in-transaction revision allocation,
 * verified persistence, and strict session isolation.
 * Prevents Session A from overwriting an active Session B, and prevents resurrected cleared sessions.
 */
export async function saveActiveExam(state: ActiveExamState): Promise<ActiveExamSaveResult> {
  // 1. Snapshot supplied state immediately to prevent caller mutations during persistence
  const stateSnapshot: ActiveExamState = JSON.parse(JSON.stringify(state));
  const sessionId = stateSnapshot.sessionId || `sess_${stateSnapshot.setNumber}_${stateSnapshot.examStartTime || Date.now()}`;
  stateSnapshot.sessionId = sessionId;

  return queueWrite(stateSnapshot.setNumber, async () => {
    // 2. Primary authoritative write: IndexedDB readwrite transaction
    if (typeof indexedDB !== 'undefined') {
      try {
        const idbResult = await new Promise<{ success: boolean; envelope?: VersionedActiveExamRecord; error?: string }>(
          async (resolve) => {
            try {
              const db = await openCoordinationDb();
              const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
              const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
              const getReq = store.get(stateSnapshot.setNumber);

              let committedEnvelope: VersionedActiveExamRecord | null = null;
              let rejectReason: string | null = null;

              getReq.onsuccess = () => {
                const existing = parseEnvelopeOrMigrate(getReq.result);
                const localEnv = readLocalActiveExamEnvelope(stateSnapshot.setNumber);

                // Session-Isolation & Tombstone Checks:
                if (existing && existing.isDeleted && existing.sessionId === sessionId) {
                  rejectReason = 'Exam session has been cleared and cannot be resurrected';
                  return;
                }
                if (localEnv && localEnv.isDeleted && localEnv.sessionId === sessionId) {
                  rejectReason = 'Exam session has been cleared and cannot be resurrected';
                  return;
                }

                // An active exam of a different session cannot be overwritten by this session!
                if (existing && !existing.isDeleted && existing.sessionId !== sessionId) {
                  rejectReason = 'Active examination belongs to another session and cannot be overwritten';
                  return;
                }
                if (localEnv && !localEnv.isDeleted && localEnv.sessionId !== sessionId) {
                  rejectReason = 'Active examination belongs to another session and cannot be overwritten';
                  return;
                }

                let currentMaxRev = existing ? existing.revision : 0;
                if (localEnv && localEnv.revision > currentMaxRev) {
                  currentMaxRev = localEnv.revision;
                }

                const nextRev = currentMaxRev + 1;
                committedEnvelope = {
                  setNumber: stateSnapshot.setNumber,
                  revision: nextRev,
                  updatedAt: Date.now(),
                  sessionId,
                  storageVersion: 1,
                  isDeleted: false,
                  state: stateSnapshot,
                };

                const putReq = store.put(committedEnvelope);
                putReq.onerror = () => {
                  rejectReason = putReq.error?.message || 'IndexedDB store put failed';
                };
              };

              getReq.onerror = () => {
                rejectReason = getReq.error?.message || 'IndexedDB store get failed';
              };

              tx.oncomplete = () => {
                db.close();
                if (rejectReason || !committedEnvelope) {
                  resolve({ success: false, error: rejectReason || 'Transaction completed without commit' });
                  return;
                }
                resolve({ success: true, envelope: committedEnvelope });
              };

              tx.onerror = () => {
                db.close();
                resolve({ success: false, error: tx.error?.message || 'IndexedDB transaction failed' });
              };

              tx.onabort = () => {
                db.close();
                resolve({ success: false, error: 'IndexedDB transaction aborted' });
              };
            } catch (err: any) {
              resolve({ success: false, error: err?.message || 'Failed to open IndexedDB' });
            }
          }
        );

        if (idbResult.success && idbResult.envelope) {
          // Read-back verification from IndexedDB
          const readBackIdb = await readIdbActiveExamEnvelope(stateSnapshot.setNumber);
          if (
            readBackIdb &&
            readBackIdb.revision === idbResult.envelope.revision &&
            readBackIdb.sessionId === idbResult.envelope.sessionId &&
            !readBackIdb.isDeleted &&
            readBackIdb.state &&
            isStateDeepEqual(readBackIdb.state, stateSnapshot)
          ) {
            // Mirror to localStorage replica and memory cache
            writeLocalActiveExamEnvelope(idbResult.envelope);
            memoryActiveExams.set(stateSnapshot.setNumber, idbResult.envelope);
            return { success: true, storageType: 'indexedDB' };
          } else {
            return { success: false, error: 'IndexedDB read-back verification failed' };
          }
        } else if (idbResult.error) {
          if (
            idbResult.error.includes('cannot be resurrected') ||
            idbResult.error.includes('belongs to another session')
          ) {
            return { success: false, error: idbResult.error };
          }
        }
      } catch {
        // Fall through to localStorage fallback
      }
    }

    // 3. Fallback persistence: localStorage
    try {
      const localExisting = readLocalActiveExamEnvelope(stateSnapshot.setNumber);
      if (localExisting && localExisting.isDeleted && localExisting.sessionId === sessionId) {
        return { success: false, error: 'Exam session has been cleared and cannot be resurrected' };
      }
      if (localExisting && !localExisting.isDeleted && localExisting.sessionId !== sessionId) {
        return { success: false, error: 'Active examination belongs to another session and cannot be overwritten' };
      }

      const nextRev = (localExisting?.revision || 0) + 1;
      const envelope: VersionedActiveExamRecord = {
        setNumber: stateSnapshot.setNumber,
        revision: nextRev,
        updatedAt: Date.now(),
        sessionId,
        storageVersion: 1,
        isDeleted: false,
        state: stateSnapshot,
      };

      const localSuccess = writeLocalActiveExamEnvelope(envelope);
      if (localSuccess) {
        memoryActiveExams.set(stateSnapshot.setNumber, envelope);
        return { success: true, storageType: 'localStorage' };
      }
    } catch {
      // Local failed
    }

    return {
      success: false,
      error: 'Both IndexedDB and localStorage failed to persist active examination state.',
    };
  });
}

/**
 * Versioned deletion tombstone protocol for clearing active examinations.
 * Commits a higher-revision tombstone to prevent stale asynchronous writes or caches
 * from resurrecting a cleared exam. Supports session-specific clearing to prevent
 * an old session from clearing a newer retake.
 */
export async function clearActiveExam(
  setNumber: number,
  expectedSessionId?: string
): Promise<ClearActiveExamResult> {
  invalidateActiveExamCache(setNumber);
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(`${SUBMISSION_GUARD_KEY}${setNumber}`);
    } catch {
      // Ignore
    }
  }

  return queueWrite(setNumber, async () => {
    // 1. Authoritative write of deletion tombstone to IndexedDB
    if (typeof indexedDB !== 'undefined') {
      try {
        const idbResult = await new Promise<{ success: boolean; tombstone?: VersionedActiveExamRecord; error?: string }>(
          async (resolve) => {
            try {
              const db = await openCoordinationDb();
              const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
              const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
              const getReq = store.get(setNumber);

              let tombstone: VersionedActiveExamRecord | null = null;
              let rejectReason: string | null = null;

              getReq.onsuccess = () => {
                const existing = parseEnvelopeOrMigrate(getReq.result);
                const localEnv = readLocalActiveExamEnvelope(setNumber);

                // Session validation if expectedSessionId is provided
                if (expectedSessionId !== undefined) {
                  if (existing && !existing.isDeleted && existing.sessionId !== expectedSessionId) {
                    rejectReason = `Cannot clear active examination: session mismatch (expected ${expectedSessionId}, found ${existing.sessionId})`;
                    return;
                  }
                  if (localEnv && !localEnv.isDeleted && localEnv.sessionId !== expectedSessionId) {
                    rejectReason = `Cannot clear active examination: session mismatch (expected ${expectedSessionId}, found ${localEnv.sessionId})`;
                    return;
                  }
                  // Idempotent success if already tombstoned for this exact session
                  if (existing && existing.isDeleted && existing.sessionId === expectedSessionId) {
                    tombstone = existing;
                    return;
                  }
                }

                let currentMaxRev = existing ? existing.revision : 0;
                if (localEnv && localEnv.revision > currentMaxRev) {
                  currentMaxRev = localEnv.revision;
                }

                const nextRev = currentMaxRev + 1;
                const tombstoneSessionId =
                  expectedSessionId || existing?.sessionId || localEnv?.sessionId || `sess_${setNumber}_tombstone_${Date.now()}`;

                tombstone = {
                  setNumber,
                  revision: nextRev,
                  updatedAt: Date.now(),
                  sessionId: tombstoneSessionId,
                  storageVersion: 1,
                  isDeleted: true,
                  state: undefined,
                };

                const putReq = store.put(tombstone);
                putReq.onerror = () => {
                  rejectReason = putReq.error?.message || 'IndexedDB store put failed';
                };
              };

              getReq.onerror = () => {
                rejectReason = getReq.error?.message || 'IndexedDB store get failed';
              };

              tx.oncomplete = () => {
                db.close();
                if (rejectReason || !tombstone) {
                  resolve({ success: false, error: rejectReason || 'Transaction completed without commit' });
                  return;
                }
                resolve({ success: true, tombstone });
              };

              tx.onerror = () => {
                db.close();
                resolve({ success: false, error: tx.error?.message || 'IndexedDB transaction failed' });
              };

              tx.onabort = () => {
                db.close();
                resolve({ success: false, error: 'IndexedDB transaction aborted' });
              };
            } catch (err: any) {
              resolve({ success: false, error: err?.message || 'Failed to open IndexedDB' });
            }
          }
        );

        if (idbResult.success && idbResult.tombstone) {
          // Read-back verification
          const readBackIdb = await readIdbActiveExamEnvelope(setNumber);
          if (
            readBackIdb &&
            readBackIdb.isDeleted === true &&
            readBackIdb.revision === idbResult.tombstone.revision
          ) {
            writeLocalActiveExamEnvelope(idbResult.tombstone);
            memoryActiveExams.set(setNumber, idbResult.tombstone);
            return { success: true, tombstone: idbResult.tombstone };
          } else {
            return { success: false, error: 'IndexedDB tombstone read-back verification failed' };
          }
        } else if (idbResult.error) {
          if (idbResult.error.includes('session mismatch')) {
            return { success: false, error: idbResult.error };
          }
        }
      } catch {
        // Fall through to localStorage fallback
      }
    }

    // 2. Fallback: localStorage deletion tombstone
    try {
      const localExisting = readLocalActiveExamEnvelope(setNumber);
      if (expectedSessionId !== undefined) {
        if (localExisting && !localExisting.isDeleted && localExisting.sessionId !== expectedSessionId) {
          return {
            success: false,
            error: `Cannot clear active examination: session mismatch (expected ${expectedSessionId}, found ${localExisting.sessionId})`,
          };
        }
        if (localExisting && localExisting.isDeleted && localExisting.sessionId === expectedSessionId) {
          memoryActiveExams.set(setNumber, localExisting);
          return { success: true, tombstone: localExisting };
        }
      }

      const nextRev = (localExisting?.revision || 0) + 1;
      const sessionId =
        expectedSessionId || localExisting?.sessionId || `sess_${setNumber}_tombstone_${Date.now()}`;

      const tombstone: VersionedActiveExamRecord = {
        setNumber,
        revision: nextRev,
        updatedAt: Date.now(),
        sessionId,
        storageVersion: 1,
        isDeleted: true,
        state: undefined,
      };

      const localSuccess = writeLocalActiveExamEnvelope(tombstone);
      if (localSuccess) {
        memoryActiveExams.set(setNumber, tombstone);
        return { success: true, tombstone };
      }
    } catch {
      // Local failed
    }

    return { success: false, error: 'Failed to persist deletion tombstone' };
  });
}

// ----------------- CROSS-TAB RECOVERY COORDINATION & FENCED LEASES -----------------

/**
 * Claims a recovery lease with owner ID and monotonically incremented fencing token.
 * Truly monotonic: uses a dedicated fence_counters store whose high-water mark is never deleted on release.
 */
export async function acquireIdbLeaseWithFencing(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS
): Promise<{ success: boolean; acquired: boolean; fencingToken?: number; ownerId?: string }> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      let isAcquired = false;
      let allocatedToken = 1;
      const tx = db.transaction([IDB_STORE_LEASES, IDB_STORE_FENCE_COUNTERS], 'readwrite');
      const leaseStore = tx.objectStore(IDB_STORE_LEASES);
      const counterStore = tx.objectStore(IDB_STORE_FENCE_COUNTERS);
      const leaseKey = `set_${setNumber}`;

      const counterReq = counterStore.get(setNumber);
      counterReq.onsuccess = () => {
        const counterRecord = counterReq.result;
        const previousHighWater =
          counterRecord && Number.isInteger(counterRecord.lastToken) ? counterRecord.lastToken : 0;
        allocatedToken = previousHighWater + 1;

        const leaseReq = leaseStore.get(leaseKey);
        leaseReq.onsuccess = () => {
          const existingLease = leaseReq.result;
          const now = Date.now();
          if (existingLease && existingLease.expiresAt > now && existingLease.ownerId !== ownerId) {
            // Unexpired lease owned by someone else
            isAcquired = false;
            return;
          }

          // Persist strictly monotonic token counter
          counterStore.put({ setNumber, lastToken: allocatedToken });

          // Put lease
          const leaseRecord = {
            key: leaseKey,
            setNumber,
            ownerId,
            fencingToken: allocatedToken,
            expiresAt: now + ttlMs,
          };
          const putReq = leaseStore.put(leaseRecord);
          putReq.onsuccess = () => {
            isAcquired = true;
          };
          putReq.onerror = () => {
            isAcquired = false;
          };
        };
        leaseReq.onerror = () => {
          isAcquired = false;
        };
      };
      counterReq.onerror = () => {
        isAcquired = false;
      };

      tx.oncomplete = () => {
        db.close();
        resolve({
          success: isAcquired,
          acquired: isAcquired,
          fencingToken: isAcquired ? allocatedToken : undefined,
          ownerId: isAcquired ? ownerId : undefined,
        });
      };
      tx.onerror = () => {
        db.close();
        resolve({ success: false, acquired: false });
      };
      tx.onabort = () => {
        db.close();
        resolve({ success: false, acquired: false });
      };
    });
  } catch {
    return { success: false, acquired: false };
  }
}

export async function acquireIdbLease(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS
): Promise<boolean> {
  const res = await acquireIdbLeaseWithFencing(setNumber, ownerId, ttlMs);
  return res.acquired;
}

/**
 * Renews an existing lease verifying both ownerId and fencingToken.
 */
export async function renewIdbLease(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS,
  fencingToken?: number
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
          if (fencingToken !== undefined && existing.fencingToken !== fencingToken) {
            renewed = false;
            return;
          }
          const now = Date.now();
          const putReq = store.put({
            key,
            setNumber,
            ownerId,
            fencingToken: existing.fencingToken,
            expiresAt: now + ttlMs,
          });
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
 * Releases lease only if currently owned by caller matching fencingToken.
 * Note: Never deletes from fence_counters store so high-water marks persist forever.
 */
export async function releaseIdbLease(
  setNumber: number,
  ownerId: string,
  fencingToken?: number
): Promise<void> {
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
          if (fencingToken === undefined || existing.fencingToken === fencingToken) {
            store.delete(key);
          }
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
 * Verifies that the caller currently holds active, unexpired lease ownership.
 */
export async function checkLeaseOwnership(
  setNumber: number,
  ownerId: string,
  fencingToken?: number
): Promise<boolean> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_LEASES, 'readonly');
      const store = tx.objectStore(IDB_STORE_LEASES);
      const key = `set_${setNumber}`;
      const req = store.get(key);
      req.onsuccess = () => {
        const existing = req.result;
        const now = Date.now();
        if (
          existing &&
          existing.ownerId === ownerId &&
          existing.expiresAt > now &&
          (fencingToken === undefined || existing.fencingToken === fencingToken)
        ) {
          resolve(true);
        } else {
          resolve(false);
        }
      };
      req.onerror = () => resolve(false);
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
 * Executes a recovery critical section inside an exclusive cross-tab lock with persistent fencing tokens,
 * owner-verified heartbeat renewal, and mandatory ownership assertions.
 */
export async function withRecoveryLock<T>(
  setNumber: number,
  callback: (checkpoint: RecoveryCheckpoint) => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false; error: 'recovery_in_progress' | 'lock_unavailable' }> {
  // 1. PRIMARY MECHANISM: Web Locks API combined with persistent fencing token
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
          const ownerId = `weblocks_owner_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          let fencingToken = 1;

          if (typeof indexedDB !== 'undefined') {
            const leaseRes = await acquireIdbLeaseWithFencing(setNumber, ownerId, LEASE_TIMEOUT_MS);
            if (leaseRes.acquired && leaseRes.fencingToken !== undefined) {
              fencingToken = leaseRes.fencingToken;
            }
          }

          let leaseLost = false;
          const checkpoint: RecoveryCheckpoint = {
            ownerId,
            fencingToken,
            isOwnerValid: async () => {
              if (leaseLost) return false;
              if (typeof indexedDB !== 'undefined') {
                const valid = await checkLeaseOwnership(setNumber, ownerId, fencingToken);
                if (!valid) leaseLost = true;
                return valid;
              }
              return true;
            },
            assertOwnership: async () => {
              const valid = await checkpoint.isOwnerValid();
              if (!valid) {
                leaseLost = true;
                throw new Error('RECOVERY_OWNERSHIP_LOST');
              }
            },
          };

          try {
            execResult = await callback(checkpoint);
          } finally {
            if (typeof indexedDB !== 'undefined') {
              await releaseIdbLease(setNumber, ownerId, fencingToken);
            }
          }
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

  // 2. FALLBACK MECHANISM: IndexedDB Transaction-based Lease with Heartbeat Renewal & Fencing
  if (typeof indexedDB !== 'undefined') {
    const ownerId = `owner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const leaseRes = await acquireIdbLeaseWithFencing(setNumber, ownerId, LEASE_TIMEOUT_MS);
    if (!leaseRes.acquired || leaseRes.fencingToken === undefined) {
      return {
        acquired: false,
        error: 'recovery_in_progress',
      };
    }

    const fencingToken = leaseRes.fencingToken;
    let heartbeatTimer: any = null;
    let leaseLost = false;

    const checkpoint: RecoveryCheckpoint = {
      ownerId,
      fencingToken,
      isOwnerValid: async () => {
        if (leaseLost) return false;
        const valid = await checkLeaseOwnership(setNumber, ownerId, fencingToken);
        if (!valid) leaseLost = true;
        return valid;
      },
      assertOwnership: async () => {
        const valid = await checkpoint.isOwnerValid();
        if (!valid) {
          leaseLost = true;
          throw new Error('RECOVERY_OWNERSHIP_LOST');
        }
      },
    };

    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await renewIdbLease(setNumber, ownerId, LEASE_TIMEOUT_MS, fencingToken);
        if (!renewed) {
          leaseLost = true;
        }
      } catch {
        leaseLost = true;
      }
    }, LEASE_HEARTBEAT_MS);

    try {
      const result = await callback(checkpoint);
      if (leaseLost) {
        return {
          acquired: false,
          error: 'recovery_in_progress',
        };
      }
      return { acquired: true, result };
    } catch (err: any) {
      if (err?.message === 'RECOVERY_OWNERSHIP_LOST' || leaseLost) {
        return {
          acquired: false,
          error: 'recovery_in_progress',
        };
      }
      throw err;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await releaseIdbLease(setNumber, ownerId, fencingToken);
    }
  }

  // 3. FAIL-SAFE:
  return {
    acquired: false,
    error: 'lock_unavailable',
  };
}

/**
 * Atomic Fenced Recovery Commit:
 * Inside a single atomic IndexedDB readwrite transaction over ['leases', 'active_exams', 'recovered_attempts']:
 * 1. Verifies caller holds active lease matching ownerId and fencingToken.
 * 2. Checks attempt deduplication in recovered_attempts store.
 * 3. Verifies active exam envelope belongs to the expected sessionId.
 * 4. Commits deletion tombstone to active_exams and test attempt to recovered_attempts.
 */
export async function commitFencedRecovery(
  params: CommitFencedRecoveryParams
): Promise<CommitFencedRecoveryResult> {
  const { setNumber, ownerId, fencingToken, sessionId, attempt } = params;

  // 1. Verify attempt can be persisted to primary permanent attempts storage
  const saveRes = saveAttempt(attempt);
  if (!saveRes.success) {
    return { success: false, error: saveRes.error || 'Failed to save attempt to storage' };
  }

  const rollbackAttempt = () => {
    try {
      const raw = localStorage.getItem(ATTEMPTS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        const filtered = arr.filter((a: any) => a.attemptId !== attempt.attemptId);
        localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(filtered));
      }
    } catch {
      // Ignore
    }
  };

  if (typeof indexedDB === 'undefined') {
    // If IndexedDB is not supported, fallback to sequential localStorage commit with validation
    const clearRes = await clearActiveExam(setNumber, sessionId);
    if (!clearRes.success) {
      rollbackAttempt();
      return { success: false, error: clearRes.error || 'Failed to tombstone active exam in localStorage' };
    }
    return { success: true };
  }

  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      const tx = db.transaction(
        [IDB_STORE_LEASES, IDB_STORE_ACTIVE_EXAMS, IDB_STORE_RECOVERED_ATTEMPTS],
        'readwrite'
      );
      const leaseStore = tx.objectStore(IDB_STORE_LEASES);
      const activeStore = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      const recoveredStore = tx.objectStore(IDB_STORE_RECOVERED_ATTEMPTS);

      let commitError: string | null = null;
      let committedTombstone: VersionedActiveExamRecord | null = null;

      // 1. Verify lease ownership & fencing token inside transaction
      const leaseKey = `set_${setNumber}`;
      const leaseReq = leaseStore.get(leaseKey);

      leaseReq.onsuccess = () => {
        const lease = leaseReq.result;
        const now = Date.now();
        if (
          !lease ||
          lease.ownerId !== ownerId ||
          lease.fencingToken !== fencingToken ||
          lease.expiresAt <= now
        ) {
          commitError = 'RECOVERY_OWNERSHIP_LOST: Active lease ownership check failed';
          return;
        }

        // 2. Check deduplication in recovered_attempts
        const dedupReq = recoveredStore.get(attempt.attemptId);
        dedupReq.onsuccess = () => {
          if (dedupReq.result) {
            commitError = `Attempt ${attempt.attemptId} has already been recovered`;
            return;
          }

          // 3. Check active exam envelope
          const activeReq = activeStore.get(setNumber);
          activeReq.onsuccess = () => {
            const existing = parseEnvelopeOrMigrate(activeReq.result);
            if (existing) {
              if (!existing.isDeleted && existing.sessionId !== sessionId) {
                commitError = `Session mismatch: expected session ${sessionId} but found active session ${existing.sessionId}`;
                return;
              }
              if (existing.isDeleted && existing.sessionId !== sessionId) {
                commitError = `Session mismatch: expected session ${sessionId} but found tombstone session ${existing.sessionId}`;
                return;
              }
            }

            // 4. Allocate next revision for tombstone
            const localEnv = readLocalActiveExamEnvelope(setNumber);
            let currentMaxRev = existing ? existing.revision : 0;
            if (localEnv && localEnv.revision > currentMaxRev) {
              currentMaxRev = localEnv.revision;
            }

            const nextRev = currentMaxRev + 1;
            committedTombstone = {
              setNumber,
              revision: nextRev,
              updatedAt: Date.now(),
              sessionId,
              storageVersion: 1,
              isDeleted: true,
              state: undefined,
            };

            // 5. Commit tombstone to active_exams and attempt to recovered_attempts
            activeStore.put(committedTombstone);
            recoveredStore.put(attempt);
          };
          activeReq.onerror = () => {
            commitError = activeReq.error?.message || 'Failed to inspect active_exams store';
          };
        };
        dedupReq.onerror = () => {
          commitError = dedupReq.error?.message || 'Failed to inspect recovered_attempts store';
        };
      };
      leaseReq.onerror = () => {
        commitError = leaseReq.error?.message || 'Failed to inspect leases store';
      };

      tx.oncomplete = () => {
        db.close();
        if (commitError || !committedTombstone) {
          rollbackAttempt();
          resolve({ success: false, error: commitError || 'Transaction completed without commit' });
          return;
        }

        // Mirror tombstone to localStorage and memory cache
        writeLocalActiveExamEnvelope(committedTombstone);
        memoryActiveExams.set(setNumber, committedTombstone);

        resolve({ success: true });
      };

      tx.onerror = () => {
        db.close();
        rollbackAttempt();
        resolve({ success: false, error: tx.error?.message || 'commitFencedRecovery transaction failed' });
      };

      tx.onabort = () => {
        db.close();
        rollbackAttempt();
        resolve({ success: false, error: commitError || 'commitFencedRecovery transaction aborted' });
      };
    });
  } catch (err: any) {
    rollbackAttempt();
    return { success: false, error: err?.message || 'Failed to open coordination database' };
  }
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
 * Reliable Asynchronous Expired Exam Recovery with Cross-Tab Coordination & Atomic Fenced Commits.
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
  const examSessionId = activeExam.sessionId || `sess_${setNumber}_${examSessionStart}`;

  const allAttempts = getAllAttempts();
  const existingAttempt = allAttempts.find((a) => a.attemptId === stableAttemptId);
  if (existingAttempt) {
    await clearActiveExam(setNumber, examSessionId);
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

  const lockResult = await withRecoveryLock(setNumber, async (checkpoint) => {
    // Checkpoint 1: Before preparing the recovered attempt
    await checkpoint.assertOwnership();

    const historyUnderLock = getAllAttempts().find((a) => a.attemptId === stableAttemptId);
    if (historyUnderLock) {
      await clearActiveExam(setNumber, examSessionId);
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

    // Checkpoint 2: Immediately before persisting the attempt
    await checkpoint.assertOwnership();

    // Atomic recovery commit: commits attempt + tombstone with lease & session check
    const commitRes = await commitFencedRecovery({
      setNumber,
      ownerId: checkpoint.ownerId,
      fencingToken: checkpoint.fencingToken,
      sessionId: examSessionId,
      attempt,
    });

    if (!commitRes.success) {
      return {
        status: 'storage_error' as const,
        setNumber,
        message: commitRes.error || 'Failed to commit recovered examination',
      };
    }

    // Checkpoint 3: After commit, before broadcasting and marking success
    await checkpoint.assertOwnership();

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
      await clearActiveExam(setNumber, examSessionId);
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

export async function clearAllUserData(): Promise<void> {
  localStorage.removeItem(ATTEMPTS_KEY);
  memoryActiveExams.clear();
  quarantinedSets.clear();
  const clearPromises: Promise<any>[] = [];
  for (let s = 1; s <= 20; s++) {
    clearPromises.push(clearActiveExam(s));
    try {
      localStorage.removeItem(`oir_recent_recovery_${s}`);
      localStorage.removeItem(`oir_recovery_lock_${s}`);
    } catch {
      // Ignore
    }
  }
  await Promise.all(clearPromises);

  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openCoordinationDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([IDB_STORE_RECOVERED_ATTEMPTS, IDB_STORE_LEASES], 'readwrite');
        tx.objectStore(IDB_STORE_RECOVERED_ATTEMPTS).clear();
        tx.objectStore(IDB_STORE_LEASES).clear();
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
}
