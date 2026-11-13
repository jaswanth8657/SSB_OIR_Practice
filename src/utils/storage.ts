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

  // sessionId: non-empty string, or fallback generated session id for legacy records
  const sessionId =
    typeof obj.sessionId === 'string' && obj.sessionId.trim()
      ? obj.sessionId
      : `sess_${obj.setNumber}_${obj.updatedAt || Date.now()}`;

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
 * Explicit, safe migration for legacy unversioned active exam records.
 * Never allows a corrupted versioned envelope to accidentally enter legacy migration.
 */
export function migrateLegacyActiveExam(raw: unknown): VersionedActiveExamRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, any>;

  // A versioned envelope (or corrupted attempt at one) must never enter legacy migration
  if ('storageVersion' in obj || 'revision' in obj || 'isDeleted' in obj) return null;

  // Must be a valid legacy ActiveExamState
  if (!Number.isInteger(obj.setNumber) || obj.setNumber < 1 || obj.setNumber > 20) return null;
  if (!Number.isInteger(obj.currentQuestionIndex) || obj.currentQuestionIndex < 0 || obj.currentQuestionIndex > 49) return null;
  if (!obj.userAnswers || typeof obj.userAnswers !== 'object' || Array.isArray(obj.userAnswers)) return null;

  const sessionId = `sess_${obj.setNumber}_${obj.examStartTime || Date.now()}_legacy`;
  return {
    setNumber: obj.setNumber,
    revision: 1,
    updatedAt: obj.currentQuestionStartedAt || obj.examStartTime || Date.now(),
    sessionId,
    storageVersion: 1,
    isDeleted: false,
    state: obj as ActiveExamState,
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
 * Read versioned envelope from IndexedDB.
 */
export function readIdbActiveExamEnvelope(setNumber: number): Promise<VersionedActiveExamRecord | null> {
  return new Promise(async (resolve) => {
    try {
      const db = await openCoordinationDb();
      const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readonly');
      const store = tx.objectStore(IDB_STORE_ACTIVE_EXAMS);
      const req = store.get(setNumber);
      req.onsuccess = () => {
        const validated = parseEnvelopeOrMigrate(req.result);
        resolve(validated);
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
 * Asynchronously retrieve active examination state with dual-store revision comparison
 * and automatic stale storage repair. Releases quarantine upon completion.
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
      // Stale IDB detected: repair with newer local record inside IDB transaction
      if (typeof indexedDB !== 'undefined') {
        try {
          const db = await openCoordinationDb();
          const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
          tx.objectStore(IDB_STORE_ACTIVE_EXAMS).put(localEnv);
          tx.oncomplete = () => db.close();
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
            const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
            tx.objectStore(IDB_STORE_ACTIVE_EXAMS).put(localEnv);
            tx.oncomplete = () => db.close();
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
    winner = localEnv;
    if (typeof indexedDB !== 'undefined') {
      try {
        const db = await openCoordinationDb();
        const tx = db.transaction(IDB_STORE_ACTIVE_EXAMS, 'readwrite');
        tx.objectStore(IDB_STORE_ACTIVE_EXAMS).put(localEnv);
        tx.oncomplete = () => db.close();
      } catch {
        // Ignore
      }
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
 * Save active examination state with state snapshotting, in-transaction revision allocation,
 * verified persistence, and stale-session resurrection protection.
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

                // Stale-session protection:
                // If a tombstone exists for this exact sessionId, the session has been cleared/recovered
                if (existing && existing.isDeleted && existing.sessionId === sessionId) {
                  rejectReason = 'Exam session has been cleared and cannot be resurrected';
                  return;
                }

                // Check localStorage replica in case it has a higher revision
                const localEnv = readLocalActiveExamEnvelope(stateSnapshot.setNumber);
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
        } else if (idbResult.error && idbResult.error.includes('cannot be resurrected')) {
          return { success: false, error: idbResult.error };
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
 * from resurrecting a cleared exam.
 */
export async function clearActiveExam(setNumber: number): Promise<ClearActiveExamResult> {
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

                let currentMaxRev = existing ? existing.revision : 0;
                if (localEnv && localEnv.revision > currentMaxRev) {
                  currentMaxRev = localEnv.revision;
                }

                const nextRev = currentMaxRev + 1;
                const sessionId = existing?.sessionId || localEnv?.sessionId || `sess_${setNumber}_tombstone_${Date.now()}`;

                tombstone = {
                  setNumber,
                  revision: nextRev,
                  updatedAt: Date.now(),
                  sessionId,
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
        }
      } catch {
        // Fall through to localStorage fallback
      }
    }

    // 2. Fallback: localStorage deletion tombstone
    try {
      const localExisting = readLocalActiveExamEnvelope(setNumber);
      const nextRev = (localExisting?.revision || 0) + 1;
      const sessionId = localExisting?.sessionId || `sess_${setNumber}_tombstone_${Date.now()}`;

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
 */
export async function acquireIdbLeaseWithFencing(
  setNumber: number,
  ownerId: string,
  ttlMs = LEASE_TIMEOUT_MS
): Promise<{ success: boolean; acquired: boolean; fencingToken?: number }> {
  try {
    const db = await openCoordinationDb();
    return new Promise((resolve) => {
      let isAcquired = false;
      let allocatedToken = 1;
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
        allocatedToken = ((existing && existing.fencingToken) || 0) + 1;
        const putReq = store.put({ key, setNumber, ownerId, fencingToken: allocatedToken, expiresAt: now + ttlMs });
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
        resolve({ success: isAcquired, acquired: isAcquired, fencingToken: isAcquired ? allocatedToken : undefined });
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
 * Releases lease only if currently owned by the caller matching fencingToken.
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
 * Executes a recovery critical section inside an exclusive cross-tab lock with fencing tokens,
 * owner-verified heartbeat renewal, and mandatory ownership assertions.
 */
export async function withRecoveryLock<T>(
  setNumber: number,
  callback: (checkpoint: RecoveryCheckpoint) => Promise<T>
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
          const checkpoint: RecoveryCheckpoint = {
            ownerId: 'weblocks_owner',
            fencingToken: 1,
            isOwnerValid: async () => true,
            assertOwnership: async () => {},
          };
          execResult = await callback(checkpoint);
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
 * Reliable Asynchronous Expired Exam Recovery with Cross-Tab Coordination & Fencing Checkpoints.
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

  const lockResult = await withRecoveryLock(setNumber, async (checkpoint) => {
    // Checkpoint 1: Before preparing the recovered attempt
    await checkpoint.assertOwnership();

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

    // Checkpoint 2: Immediately before persisting the attempt
    await checkpoint.assertOwnership();

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

    // Checkpoint 3: Before clearing or tombstoning the active exam
    await checkpoint.assertOwnership();

    const clearResult = await clearActiveExam(setNumber);
    if (!clearResult.success) {
      return {
        status: 'storage_error' as const,
        setNumber,
        message: clearResult.error || 'Failed to persist deletion tombstone',
      };
    }

    // Checkpoint 4: Before marking recovery successful
    await checkpoint.assertOwnership();

    try {
      localStorage.setItem(
        `oir_recent_recovery_${setNumber}`,
        JSON.stringify({ attemptId: stableAttemptId, expiresAt: Date.now() + 30000 })
      );
    } catch {
      // Ignore
    }

    // Checkpoint 5: Before broadcasting EXAM_RECOVERED
    await checkpoint.assertOwnership();

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
  quarantinedSets.clear();
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
