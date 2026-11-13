import { Question, UserAnswer, TestAttempt } from '../types/oir';
import { evaluateAnswer } from './evaluator';

export interface ScoringSummary {
  totalQuestions: number;
  maxScore: number;
  score: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unansweredQuestions: number;
  excludedQuestions: number;
  answeredScoredQuestions: number;
  accuracyPercentage: number;
  gradedAnswers: Record<number, UserAnswer>;
}

/**
 * Shared production scoring function used for both manual submissions and expired exam recovery.
 * Guarantees consistent accuracy calculations and respects scoring exclusions (e.g. Set 06 Q11).
 */
export function computeAttemptScore(
  questions: Question[],
  userAnswers: Record<number, UserAnswer>
): ScoringSummary {
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let excludedCount = 0;

  const gradedAnswers: Record<number, UserAnswer> = {};

  questions.forEach((q) => {
    const qNum = q.questionNumber;
    const uAns = userAnswers[qNum];

    // If the question is excluded from scoring (e.g. Set 06 Q11 source discrepancy)
    if (q.scoringExcluded) {
      excludedCount++;
      gradedAnswers[qNum] = {
        questionNumber: qNum,
        selectedOption: uAns?.selectedOption,
        twoPartAnswer: uAns?.twoPartAnswer,
        dropdownSelection: uAns?.dropdownSelection,
        isAnswered: Boolean(uAns?.isAnswered),
        isCorrect: false,
        isExcluded: true,
      };
      return;
    }

    // Scored question evaluation
    if (!uAns || !uAns.isAnswered) {
      unansweredCount++;
      gradedAnswers[qNum] = {
        questionNumber: qNum,
        selectedOption: undefined,
        twoPartAnswer: undefined,
        dropdownSelection: undefined,
        isAnswered: false,
        isCorrect: false,
        isExcluded: false,
      };
      return;
    }

    const evalRes = evaluateAnswer(
      q,
      uAns.selectedOption,
      uAns.twoPartAnswer,
      uAns.dropdownSelection
    );

    if (evalRes.isCorrect) {
      correctCount++;
      gradedAnswers[qNum] = {
        ...uAns,
        isCorrect: true,
        isExcluded: false,
      };
    } else {
      incorrectCount++;
      gradedAnswers[qNum] = {
        ...uAns,
        isCorrect: false,
        isExcluded: false,
      };
    }
  });

  const totalQuestions = questions.length;
  const maxScore = totalQuestions - excludedCount;
  const answeredScoredQuestions = correctCount + incorrectCount;

  // Accuracy: Correct Answers / Answered Scored Questions * 100
  const accuracyPercentage =
    answeredScoredQuestions > 0
      ? Math.round((correctCount / answeredScoredQuestions) * 100)
      : 0;

  return {
    totalQuestions,
    maxScore,
    score: correctCount,
    correctAnswers: correctCount,
    incorrectAnswers: incorrectCount,
    unansweredQuestions: unansweredCount,
    excludedQuestions: excludedCount,
    answeredScoredQuestions,
    accuracyPercentage,
    gradedAnswers,
  };
}

/**
 * Creates a fully formatted TestAttempt using the shared scoring engine.
 */
export function buildTestAttempt(
  setNumber: number,
  questions: Question[],
  userAnswers: Record<number, UserAnswer>,
  timeTakenSeconds: number,
  attemptId: string,
  timestamp: number = Date.now()
): TestAttempt {
  const summary = computeAttemptScore(questions, userAnswers);

  return {
    attemptId,
    setNumber,
    timestamp,
    totalQuestions: summary.totalQuestions,
    maxScore: summary.maxScore,
    score: summary.score,
    correctAnswers: summary.correctAnswers,
    incorrectAnswers: summary.incorrectAnswers,
    unansweredQuestions: summary.unansweredQuestions,
    excludedQuestions: summary.excludedQuestions,
    accuracyPercentage: summary.accuracyPercentage,
    timeTakenSeconds,
    userAnswers: summary.gradedAnswers,
  };
}
