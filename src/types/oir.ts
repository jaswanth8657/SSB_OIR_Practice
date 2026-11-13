export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'boolean'
  | 'text'
  | 'two_part_letter'
  | 'two_part_number'
  | 'multi_dropdown'
  | 'numerical';

export interface QuestionOption {
  id: string;
  text: string;
  image?: string;
}

export interface DropdownGroup {
  options: { id: string; text: string }[];
}

export interface Question {
  id: number;
  setNumber: number;
  questionNumber: number;
  instruction?: string;
  statement: string;
  type: QuestionType;
  images: string[];
  options: QuestionOption[];
  dropdownGroups?: DropdownGroup[];
  correctAnswer: string;
  explanation: string;
  solutionImage?: string;
  solutionImages?: string[];
  hasSourceDiscrepancy?: boolean;
  sourceDiscrepancyNote?: string;
  scoringExcluded?: boolean;
  scoringExclusionReason?: string;
  hasMissingSourceExplanation?: boolean;
  pdfPage?: number;
}

export interface PracticeSetMeta {
  setNumber: number;
  name: string;
  totalQuestions: number;
  defaultDurationMinutes: number;
  defaultQuestionTimeSeconds: number;
  totalImages: number;
}

export interface UserAnswer {
  questionNumber: number;
  selectedOption?: string | string[]; // Single choice ID, array of figure IDs, or text
  twoPartAnswer?: [string, string]; // [Part 1, Part 2] for Q13 and Q45
  dropdownSelection?: string[]; // [Line 1 ID, Line 2 ID, Line 3 ID] for Q18
  isAnswered: boolean;
  isCorrect?: boolean;
  isExcluded?: boolean;
  timeSpentSeconds?: number;
}

export interface TestAttempt {
  attemptId: string;
  setNumber: number;
  timestamp: number;
  totalQuestions: number;
  maxScore: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unansweredQuestions: number;
  excludedQuestions: number;
  score: number;
  accuracyPercentage: number;
  timeTakenSeconds: number;
  userAnswers: Record<number, UserAnswer>;
  isLegacyUnverified?: boolean;
  legacyStatus?: 'verified' | 'review_required';
  legacyNote?: string;
  originalScore?: number;
}

export type RecoveryResult =
  | { status: 'recovered'; attempt: TestAttempt }
  | { status: 'already_recovered'; attempt: TestAttempt }
  | { status: 'not_expired' }
  | { status: 'no_active_exam' }
  | { status: 'recovery_in_progress' }
  | { status: 'storage_error'; setNumber: number; message: string }
  | { status: 'lock_unavailable'; setNumber: number; message: string };

export interface ActiveExamSaveResult {
  success: boolean;
  storageType?: 'localStorage' | 'indexedDB';
  error?: string;
}

export interface RecoveryBroadcastMessage {
  type: 'EXAM_RECOVERED';
  setNumber: number;
  attemptId: string;
  timestamp: number;
}

export interface VersionedActiveExamRecord {
  setNumber: number;
  revision: number;
  updatedAt: number;
  sessionId: string;
  storageVersion: number;
  isDeleted: boolean;
  state?: ActiveExamState;
}

export interface ClearActiveExamResult {
  success: boolean;
  error?: string;
  tombstone?: VersionedActiveExamRecord;
}

export interface RecoveryCheckpoint {
  ownerId: string;
  fencingToken: number;
  assertOwnership: () => Promise<void>;
  isOwnerValid: () => Promise<boolean>;
}

export interface UserSettings {
  questionTimeSeconds: number;
  totalDurationMinutes: number;
  soundEnabled?: boolean;
}

export interface SetProgress {
  setNumber: number;
  status: 'not_started' | 'in_progress' | 'completed';
  attemptsCount: number;
  bestScore?: number;
  lastAttemptTimestamp?: number;
}

export interface ActiveExamState {
  setNumber: number;
  currentQuestionIndex: number; // 0-based (0..49)
  userAnswers: Record<number, UserAnswer>; // keyed by questionNumber (1..50)
  examStartTime: number; // timestamp ms
  examEndTime: number; // timestamp ms
  questionTimeLeft: Record<number, number>; // remaining seconds for each question
  currentQuestionStartedAt: number; // timestamp ms when active question started
  questionExpiredMap: Record<number, boolean>; // questions whose time has run out
  isPaused?: boolean;
  sessionId?: string;
}

export interface OverallStats {
  totalPracticeSets: number;
  completedSets: number;
  totalAttempts: number;
  totalQuestionsPracticed: number;
  questionsAnswered: number;
  overallAccuracy: number;
  bestPerformance: number;
}
