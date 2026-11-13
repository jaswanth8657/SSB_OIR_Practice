import { describe, it, expect } from 'vitest';
import { computeAttemptScore, buildTestAttempt } from '../src/utils/scoring';
import { Question, UserAnswer } from '../src/types/oir';

describe('Production Scoring Engine (src/utils/scoring.ts)', () => {
  // Mock standard set with 50 questions
  const createMockSet = (scoringExcludedQNum?: number): Question[] => {
    const list: Question[] = [];
    for (let i = 1; i <= 50; i++) {
      list.push({
        id: i,
        setNumber: 1,
        questionNumber: i,
        statement: `Question ${i}`,
        type: 'single_choice',
        images: [],
        options: [
          { id: '1', text: 'Correct Opt' },
          { id: '2', text: 'Wrong Opt' },
        ],
        correctAnswer: '(1)',
        explanation: 'Explanation',
        scoringExcluded: i === scoringExcludedQNum,
      });
    }
    return list;
  };

  it('calculates maximum score of 50 for standard sets without exclusions', () => {
    const questions = createMockSet();
    const userAnswers: Record<number, UserAnswer> = {};
    for (let i = 1; i <= 50; i++) {
      userAnswers[i] = {
        questionNumber: i,
        selectedOption: '1',
        isAnswered: true,
      };
    }

    const summary = computeAttemptScore(questions, userAnswers);
    expect(summary.totalQuestions).toBe(50);
    expect(summary.maxScore).toBe(50);
    expect(summary.score).toBe(50);
    expect(summary.correctAnswers).toBe(50);
    expect(summary.incorrectAnswers).toBe(0);
    expect(summary.unansweredQuestions).toBe(0);
    expect(summary.excludedQuestions).toBe(0);
    expect(summary.accuracyPercentage).toBe(100);
  });

  // Task 4: Set 06 Maximum Score of 49 and Question 11 Exclusion
  it('calculates maximum score of 49 for Set 06 when Q11 is excluded from scoring', () => {
    const questions = createMockSet(11); // Q11 excluded

    const userAnswers: Record<number, UserAnswer> = {};
    // 40 correct answers (Q1..Q40)
    for (let i = 1; i <= 40; i++) {
      userAnswers[i] = {
        questionNumber: i,
        selectedOption: '1',
        isAnswered: true,
      };
    }
    // 5 incorrect answers (Q41..Q45)
    for (let i = 41; i <= 45; i++) {
      userAnswers[i] = {
        questionNumber: i,
        selectedOption: '2',
        isAnswered: true,
      };
    }
    // Q46..Q49 left unanswered
    // Q50 answered correct
    userAnswers[50] = {
      questionNumber: 50,
      selectedOption: '1',
      isAnswered: true,
    };
    // Q11 is among Q1..Q40 (answered), but excluded!
    // Since Q11 is excluded:
    // Scored correct: 40 (Q1..Q10, Q12..Q40, Q50) = 10 + 29 + 1 = 40
    // Scored incorrect: 5 (Q41..Q45)
    // Scored unanswered: 4 (Q46..Q49)
    // Excluded: 1 (Q11)

    const summary = computeAttemptScore(questions, userAnswers);

    expect(summary.totalQuestions).toBe(50);
    expect(summary.maxScore).toBe(49);
    expect(summary.score).toBe(40);
    expect(summary.correctAnswers).toBe(40);
    expect(summary.incorrectAnswers).toBe(5);
    expect(summary.unansweredQuestions).toBe(4);
    expect(summary.excludedQuestions).toBe(1);

    // Invariant: Correct + Incorrect + Unanswered + Excluded === Total Questions
    const sum =
      summary.correctAnswers +
      summary.incorrectAnswers +
      summary.unansweredQuestions +
      summary.excludedQuestions;
    expect(sum).toBe(50);

    // Accuracy: 40 / (40 + 5) * 100 = 88.89% -> 89%
    expect(summary.accuracyPercentage).toBe(89);
  });

  it('buildTestAttempt generates complete TestAttempt adhering to standard schema', () => {
    const questions = createMockSet(11);
    const userAnswers: Record<number, UserAnswer> = {
      1: { questionNumber: 1, selectedOption: '1', isAnswered: true },
      2: { questionNumber: 2, selectedOption: '2', isAnswered: true },
    };

    const attempt = buildTestAttempt(6, questions, userAnswers, 900, 'att_6_test');
    expect(attempt.attemptId).toBe('att_6_test');
    expect(attempt.setNumber).toBe(6);
    expect(attempt.maxScore).toBe(49);
    expect(attempt.score).toBe(1);
    expect(attempt.correctAnswers).toBe(1);
    expect(attempt.incorrectAnswers).toBe(1);
    expect(attempt.excludedQuestions).toBe(1);
    expect(attempt.unansweredQuestions).toBe(47);
    expect(attempt.accuracyPercentage).toBe(50);
  });
});
