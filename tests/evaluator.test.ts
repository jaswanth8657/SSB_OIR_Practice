import { describe, it, expect } from 'vitest';
import { evaluateAnswer, parseNumericValue, areNumbersEquivalent, parseTwoPart } from '../src/utils/evaluator';
import { Question } from '../src/types/oir';

describe('Production Evaluator Engine (src/utils/evaluator.ts)', () => {
  // 1. Two-Part Numerical Series (Task 2: Order requirement & normalization)
  describe('two_part_number (Question 45 series)', () => {
    const q45: Question = {
      id: 45,
      setNumber: 1,
      questionNumber: 45,
      statement: 'Which two numbers will come next in the series?',
      type: 'two_part_number',
      images: [],
      options: [],
      correctAnswer: '8 and 13',
      explanation: 'Add alternate numbers',
    };

    it('accepts exact comma-separated correct answer in order', () => {
      const res = evaluateAnswer(q45, '8, 13');
      expect(res.isCorrect).toBe(true);
    });

    it('accepts "and"-separated correct answer in order', () => {
      const res = evaluateAnswer(q45, '8 and 13');
      expect(res.isCorrect).toBe(true);
    });

    it('accepts whitespace-separated correct answer in order ("8 13")', () => {
      const res = evaluateAnswer(q45, '8 13');
      expect(res.isCorrect).toBe(true);
    });

    it('accepts two-part array in order', () => {
      const res = evaluateAnswer(q45, undefined, ['8', '13']);
      expect(res.isCorrect).toBe(true);
    });

    it('REJECTS reversed answers (Task 2 Requirement: 13, 8 must be incorrect)', () => {
      const res = evaluateAnswer(q45, '13, 8');
      expect(res.isCorrect).toBe(false);
    });

    it('REJECTS reversed array answers', () => {
      const res = evaluateAnswer(q45, undefined, ['13', '8']);
      expect(res.isCorrect).toBe(false);
    });

    it('REJECTS additional values ("8, 13, 21")', () => {
      expect(evaluateAnswer(q45, '8, 13, 21').isCorrect).toBe(false);
      expect(evaluateAnswer(q45, undefined, ['8', '13', '21'] as unknown as [string, string]).isCorrect).toBe(false);
    });

    it('REJECTS empty components ("8, , 13")', () => {
      expect(evaluateAnswer(q45, '8, , 13').isCorrect).toBe(false);
    });

    it('REJECTS NaN and Infinity in answers', () => {
      expect(evaluateAnswer(q45, 'NaN, 13').isCorrect).toBe(false);
      expect(evaluateAnswer(q45, 'Infinity, 13').isCorrect).toBe(false);
      expect(evaluateAnswer(q45, undefined, ['NaN', '13']).isCorrect).toBe(false);
      expect(evaluateAnswer(q45, undefined, ['Infinity', '13']).isCorrect).toBe(false);
    });

    it('REJECTS incorrect numbers', () => {
      const res = evaluateAnswer(q45, '8, 14');
      expect(res.isCorrect).toBe(false);
    });

    it('REJECTS incomplete single-part answers', () => {
      const res1 = evaluateAnswer(q45, '8');
      expect(res1.isCorrect).toBe(false);

      const res2 = evaluateAnswer(q45, undefined, ['8', '']);
      expect(res2.isCorrect).toBe(false);
    });

    it('correctly compares fractions and decimals (0.5, 0.25 for "1/2 and 1/4")', () => {
      const qFraction: Question = {
        id: 45,
        setNumber: 2,
        questionNumber: 45,
        statement: 'Sequence',
        type: 'two_part_number',
        images: [],
        options: [],
        correctAnswer: '1/2 and 1/4',
        explanation: '',
      };

      // Correct in order
      expect(evaluateAnswer(qFraction, '0.5, 0.25').isCorrect).toBe(true);
      expect(evaluateAnswer(qFraction, undefined, ['0.5', '0.25']).isCorrect).toBe(true);
      expect(evaluateAnswer(qFraction, '1/2 and 1/4').isCorrect).toBe(true);
      expect(evaluateAnswer(qFraction, '1/2, 1/4').isCorrect).toBe(true);

      // Reversed must be REJECTED
      expect(evaluateAnswer(qFraction, '0.25, 0.5').isCorrect).toBe(false);
      expect(evaluateAnswer(qFraction, undefined, ['0.25', '0.5']).isCorrect).toBe(false);

      // Extra values in fractions must be REJECTED
      expect(evaluateAnswer(qFraction, '1/2, 1/4, 1/8').isCorrect).toBe(false);
    });
  });

  // 2. Two-Part Letter Series (Question 13)
  describe('two_part_letter (Question 13 series)', () => {
    const q13: Question = {
      id: 13,
      setNumber: 1,
      questionNumber: 13,
      statement: 'Letter sequence',
      type: 'two_part_letter',
      images: [],
      options: [],
      correctAnswer: 'JHG, FDC',
      explanation: 'Reverse alphabetical step of 2',
    };

    it('accepts exact letters with comma in order', () => {
      expect(evaluateAnswer(q13, 'JHG, FDC').isCorrect).toBe(true);
    });

    it('accepts case-insensitive letters in order', () => {
      expect(evaluateAnswer(q13, 'jhg, fdc').isCorrect).toBe(true);
      expect(evaluateAnswer(q13, undefined, ['jhg', 'fdc']).isCorrect).toBe(true);
    });

    it('accepts "and"-separated letter answer', () => {
      expect(evaluateAnswer(q13, 'JHG and FDC').isCorrect).toBe(true);
    });

    it('rejects reversed order', () => {
      expect(evaluateAnswer(q13, 'FDC, JHG').isCorrect).toBe(false);
      expect(evaluateAnswer(q13, undefined, ['FDC', 'JHG']).isCorrect).toBe(false);
    });

    it('rejects incomplete answer', () => {
      expect(evaluateAnswer(q13, 'JHG').isCorrect).toBe(false);
    });
  });

  // 3. Multi-Dropdown Sentence Completion (Question 18)
  describe('multi_dropdown (Question 18)', () => {
    const q18: Question = {
      id: 18,
      setNumber: 1,
      questionNumber: 18,
      statement: 'Select the words to complete the sentence.',
      type: 'multi_dropdown',
      images: [],
      options: [],
      dropdownGroups: [
        { options: [{ id: '1', text: 'Eagle' }, { id: '2', text: 'Falcon' }] },
        { options: [{ id: '1', text: 'Sky' }, { id: '2', text: 'Ground' }] },
        { options: [{ id: '1', text: 'Fast' }, { id: '2', text: 'Slow' }] },
      ],
      correctAnswer: '2, 1, 2',
      explanation: 'Meaningful sentence.',
    };

    it('awards marks when all three option IDs match', () => {
      expect(evaluateAnswer(q18, undefined, undefined, ['2', '1', '2']).isCorrect).toBe(true);
    });

    it('rejects partial match (2 out of 3 correct)', () => {
      expect(evaluateAnswer(q18, undefined, undefined, ['2', '1', '1']).isCorrect).toBe(false);
    });

    it('rejects permuted IDs', () => {
      expect(evaluateAnswer(q18, undefined, undefined, ['1', '2', '2']).isCorrect).toBe(false);
    });

    it('rejects incomplete dropdown selection', () => {
      expect(evaluateAnswer(q18, undefined, undefined, ['2', '1']).isCorrect).toBe(false);
    });
  });

  // 4. Numerical Arithmetic (Questions 20 and 23)
  describe('numerical (missing digits)', () => {
    const q20: Question = {
      id: 20,
      setNumber: 1,
      questionNumber: 20,
      statement: 'Missing digit in subtraction',
      type: 'numerical',
      images: [],
      options: [],
      correctAnswer: '8',
      explanation: 'Borrow 1 from tens place.',
    };

    it('matches exact single digit', () => {
      expect(evaluateAnswer(q20, '8').isCorrect).toBe(true);
    });

    it('trims whitespace', () => {
      expect(evaluateAnswer(q20, '  8  ').isCorrect).toBe(true);
    });

    it('rejects wrong digit', () => {
      expect(evaluateAnswer(q20, '9').isCorrect).toBe(false);
    });

    it('rejects non-numeric string', () => {
      expect(evaluateAnswer(q20, 'eight').isCorrect).toBe(false);
    });
  });

  // 5. Multiple Choice Class A figures
  describe('multiple_choice (Class A figures)', () => {
    const qFig: Question = {
      id: 5,
      setNumber: 1,
      questionNumber: 5,
      statement: 'Which two figures belong to Class A?',
      type: 'multiple_choice',
      images: [],
      options: [],
      correctAnswer: '1, 4',
      explanation: 'Figures with even lines',
    };

    it('accepts exact set of figure numbers [1, 4]', () => {
      expect(evaluateAnswer(qFig, ['1', '4']).isCorrect).toBe(true);
    });

    it('accepts figure set in reversed order [4, 1] (class membership is order-independent)', () => {
      expect(evaluateAnswer(qFig, ['4', '1']).isCorrect).toBe(true);
    });

    it('rejects single figure partial choice [1]', () => {
      expect(evaluateAnswer(qFig, ['1']).isCorrect).toBe(false);
    });

    it('rejects extra figures [1, 2, 4]', () => {
      expect(evaluateAnswer(qFig, ['1', '2', '4']).isCorrect).toBe(false);
    });
  });

  // 6. Boolean (Yes / No)
  describe('boolean', () => {
    const qBool: Question = {
      id: 4,
      setNumber: 1,
      questionNumber: 4,
      statement: 'Can cube be formed?',
      type: 'boolean',
      images: [],
      options: [],
      correctAnswer: 'Yes',
      explanation: 'Opposite faces do not touch',
    };

    it('matches "Yes" and "yes"', () => {
      expect(evaluateAnswer(qBool, 'Yes').isCorrect).toBe(true);
      expect(evaluateAnswer(qBool, 'yes').isCorrect).toBe(true);
    });

    it('rejects opposite answer "No"', () => {
      expect(evaluateAnswer(qBool, 'No').isCorrect).toBe(false);
    });
  });

  // 7. Single Choice
  describe('single_choice', () => {
    const qChoice: Question = {
      id: 2,
      setNumber: 1,
      questionNumber: 2,
      statement: 'Analogy question',
      type: 'single_choice',
      images: [],
      options: [
        { id: '1', text: 'Lead' },
        { id: '2', text: 'Follow' },
      ],
      correctAnswer: '(1)',
      explanation: 'Direct synonym',
    };

    it('matches option id', () => {
      expect(evaluateAnswer(qChoice, '1').isCorrect).toBe(true);
      expect(evaluateAnswer(qChoice, '(1)').isCorrect).toBe(true);
    });

    it('rejects wrong option id', () => {
      expect(evaluateAnswer(qChoice, '2').isCorrect).toBe(false);
    });
  });

  // 8. Text (Strict anti-partial match)
  describe('text', () => {
    const qText: Question = {
      id: 11,
      setNumber: 1,
      questionNumber: 11,
      statement: 'Anagram word',
      type: 'text',
      images: [],
      options: [],
      correctAnswer: 'elephant',
      explanation: 'Rearranged letters form elephant',
    };

    it('accepts exact word (case-insensitive)', () => {
      expect(evaluateAnswer(qText, 'elephant').isCorrect).toBe(true);
      expect(evaluateAnswer(qText, 'ELEPHANT').isCorrect).toBe(true);
    });

    it('strictly REJECTS prefixes like "ele" (no false partial match)', () => {
      expect(evaluateAnswer(qText, 'ele').isCorrect).toBe(false);
    });

    it('strictly REJECTS substrings like "phant"', () => {
      expect(evaluateAnswer(qText, 'phant').isCorrect).toBe(false);
    });
  });

  // 9. Scoring Exclusion (Task 4: Set 06 Q11)
  describe('scoringExcluded flag (Task 4)', () => {
    const qExcluded: Question = {
      id: 11,
      setNumber: 6,
      questionNumber: 11,
      statement: 'Breeze is to Gusty as Stroll is to...',
      type: 'single_choice',
      images: [],
      options: [{ id: '1', text: 'Walk' }, { id: '2', text: 'Run' }],
      correctAnswer: 'N',
      explanation: 'Discrepancy in source material',
      hasSourceDiscrepancy: true,
      scoringExcluded: true,
    };

    it('marks answer as isExcluded: true and isCorrect: false', () => {
      const res = evaluateAnswer(qExcluded, '1');
      expect(res.isExcluded).toBe(true);
      expect(res.isCorrect).toBe(false);
    });
  });
});
