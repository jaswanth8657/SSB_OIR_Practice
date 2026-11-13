import { Question, UserAnswer } from '../types/oir';

export interface EvaluationResult {
  isCorrect: boolean;
  userDisplayAnswer: string;
  correctDisplayAnswer: string;
}

/**
 * Normalizes two-part answers (letters or numbers) into [part1, part2].
 * Accepts separators like comma, 'and', space, slash, etc.
 */
function parseTwoPart(input: unknown): [string, string] | null {
  if (!input) return null;

  if (Array.isArray(input)) {
    if (input.length >= 2) {
      const p1 = String(input[0]).trim();
      const p2 = String(input[1]).trim();
      if (p1 && p2) return [p1, p2];
    }
    if (input.length === 1) {
      return parseTwoPart(input[0]);
    }
  }

  const str = String(input).trim();
  // 1. First attempt split by explicit separators: comma, 'and', '&', semicolon
  let parts = str
    .split(/\s*(?:,|&|\band\b|;)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return [parts[0], parts[1]];
  }

  // 2. Second attempt: whitespace separator
  parts = str
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return [parts[0], parts[1]];
  }

  // 3. Fallback: slash only if not a fraction
  parts = str
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return [parts[0], parts[1]];
  }

  return null;
}

/**
 * Normalizes option IDs e.g. "(3)" -> "3"
 */
function extractOptionId(raw: string): string {
  const m = raw.match(/\(?(\d+)\)?/);
  return m ? m[1] : raw.trim();
}

/**
 * Evaluates a user's answer against the verified correct answer.
 * Accepts either a UserAnswer object, or individual parameters.
 */
export function evaluateAnswer(
  question: Question,
  userAnswer?: UserAnswer | string | string[],
  twoPartAnswerArg?: [string, string],
  dropdownSelectionArg?: [string, string, string] | string[]
): EvaluationResult {
  const correctRaw = (question.correctAnswer || '').trim();

  // Extract answer values from UserAnswer object or direct value
  let selectedOption: string | string[] | undefined;
  let twoPartAnswer: [string, string] | undefined = twoPartAnswerArg;
  let dropdownSelection: string[] | undefined = dropdownSelectionArg;
  let isAnswered = false;

  if (userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer) && 'isAnswered' in userAnswer) {
    selectedOption = userAnswer.selectedOption;
    twoPartAnswer = userAnswer.twoPartAnswer || twoPartAnswerArg;
    dropdownSelection = (userAnswer.dropdownSelection as string[]) || dropdownSelectionArg;
    isAnswered = userAnswer.isAnswered;
  } else if (userAnswer !== undefined && userAnswer !== null) {
    if (Array.isArray(userAnswer)) {
      selectedOption = userAnswer;
      isAnswered = userAnswer.length > 0;
    } else {
      selectedOption = String(userAnswer);
      isAnswered = String(userAnswer).trim().length > 0;
    }
  }

  if (twoPartAnswer && (twoPartAnswer[0] || twoPartAnswer[1])) {
    isAnswered = true;
  }
  if (dropdownSelection && dropdownSelection.some(Boolean)) {
    isAnswered = true;
  }

  // Guard: if user did not answer
  if (!isAnswered) {
    return {
      isCorrect: false,
      userDisplayAnswer: 'Not Answered',
      correctDisplayAnswer: formatCorrectDisplay(question, correctRaw),
    };
  }

  // 1. Two-Part Letter Series (Question 13)
  if (question.type === 'two_part_letter') {
    const userParts = twoPartAnswer || parseTwoPart(selectedOption);
    const corrParts = parseTwoPart(correctRaw);

    const userDisp = userParts ? `${userParts[0]}, ${userParts[1]}` : String(selectedOption || 'Incomplete');
    const corrDisp = corrParts ? `${corrParts[0]}, ${corrParts[1]}` : correctRaw;

    if (!userParts || !corrParts) {
      return { isCorrect: false, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
    }

    const u1 = userParts[0].toUpperCase();
    const u2 = userParts[1].toUpperCase();
    const c1 = corrParts[0].toUpperCase();
    const c2 = corrParts[1].toUpperCase();

    // Exact match of both parts in order
    const isCorrect = u1 === c1 && u2 === c2;
    return { isCorrect, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
  }

  // 2. Two-Part Numerical Series (Question 45)
  if (question.type === 'two_part_number') {
    const userParts = twoPartAnswer || parseTwoPart(selectedOption);
    const corrParts = parseTwoPart(correctRaw);

    const userDisp = userParts ? `${userParts[0]} and ${userParts[1]}` : String(selectedOption || 'Incomplete');
    const corrDisp = corrParts ? `${corrParts[0]} and ${corrParts[1]}` : correctRaw;

    if (!userParts || !corrParts) {
      return { isCorrect: false, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
    }

    const normalizeNum = (val: string) => {
      // Handle fractions like "1/4" or decimals
      if (val.includes('/')) {
        const [n, d] = val.split('/').map(Number);
        if (d) return (n / d).toString();
      }
      return val.replace(/\s+/g, '').toLowerCase();
    };

    const u1 = normalizeNum(userParts[0]);
    const u2 = normalizeNum(userParts[1]);
    const c1 = normalizeNum(corrParts[0]);
    const c2 = normalizeNum(corrParts[1]);

    const isCorrect = (u1 === c1 && u2 === c2) || (u1 === c2 && u2 === c1);
    return { isCorrect, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
  }

  // 3. Multi-Dropdown Sentence Completion (Question 18)
  if (question.type === 'multi_dropdown') {
    const userIds = dropdownSelection || (Array.isArray(selectedOption) ? selectedOption : []);
    // Correct IDs are comma or space separated numbers e.g. "2, 1, 2"
    const corrIds = (correctRaw.match(/\d+/g) || []).map(String);

    // Format display with words
    const userWords: string[] = [];
    if (question.dropdownGroups) {
      userIds.forEach((id, gIdx) => {
        const grp = question.dropdownGroups?.[gIdx];
        const opt = grp?.options.find((o) => o.id === String(id));
        userWords.push(opt ? opt.text : id || '—');
      });
    }

    const corrWords: string[] = [];
    if (question.dropdownGroups) {
      corrIds.forEach((id, gIdx) => {
        const grp = question.dropdownGroups?.[gIdx];
        const opt = grp?.options.find((o) => o.id === String(id));
        corrWords.push(opt ? opt.text : id);
      });
    }

    const userDisp = userWords.length === 3 ? `${userWords.join(', ')} (Options: ${userIds.join(', ')})` : 'Incomplete Selection';
    const corrDisp = `${corrWords.join(', ')} (Options: ${corrIds.join(', ')})`;

    // All three must match exactly
    const isCorrect =
      userIds.length === 3 &&
      corrIds.length === 3 &&
      userIds[0] === corrIds[0] &&
      userIds[1] === corrIds[1] &&
      userIds[2] === corrIds[2];

    return { isCorrect, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
  }

  // 4. Numerical Arithmetic (Questions 20 and 23)
  if (question.type === 'numerical') {
    const userStr = String(selectedOption || '').trim();
    const corrStr = correctRaw.trim();

    const isCorrect = userStr === corrStr;
    return {
      isCorrect,
      userDisplayAnswer: userStr ? `Missing Digit: ${userStr}` : 'Not Answered',
      correctDisplayAnswer: `Missing Digit: ${corrStr}`,
    };
  }

  // 5. Multiple Choice Class A figures
  if (question.type === 'multiple_choice') {
    const correctNums = (correctRaw.match(/\d+/g) || []).map(Number).sort();
    const userVals = Array.isArray(selectedOption) ? selectedOption : [selectedOption];
    const userNums = userVals
      .map((s) => Number(String(s).replace(/\D/g, '')))
      .filter((n) => !isNaN(n) && n > 0)
      .sort();

    const userDisp = userNums.length > 0 ? userNums.map((n) => `Figure ${n}`).join(', ') : 'None selected';
    const corrDisp = correctNums.map((n) => `Figure ${n}`).join(' and ');

    const isCorrect =
      correctNums.length === 2 &&
      userNums.length === 2 &&
      correctNums[0] === userNums[0] &&
      correctNums[1] === userNums[1];

    return { isCorrect, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
  }

  // 6. Boolean (Yes / No)
  if (question.type === 'boolean') {
    const userVal = String(selectedOption || '').trim().toLowerCase();
    const corrVal = correctRaw.trim().toLowerCase();

    const isYesCorr = corrVal.startsWith('yes');
    const isNoCorr = corrVal.startsWith('no');

    const isCorrect = (userVal === 'yes' && isYesCorr) || (userVal === 'no' && isNoCorr);

    return {
      isCorrect,
      userDisplayAnswer: userVal === 'yes' ? 'Yes' : userVal === 'no' ? 'No' : String(selectedOption),
      correctDisplayAnswer: isYesCorr ? 'Yes' : 'No',
    };
  }

  // 7. Single Choice
  if (question.type === 'single_choice') {
    const userStr = String(selectedOption || '').trim();
    const userOptId = extractOptionId(userStr);
    const corrOptId = extractOptionId(correctRaw);

    const userOpt = question.options?.find((o) => o.id === userOptId);
    const corrOpt = question.options?.find((o) => o.id === corrOptId);

    const userDisp = userOpt && !userOpt.text.startsWith('Option') ? `(${userOpt.id}) ${userOpt.text}` : userStr ? `Option ${userOptId}` : 'Not Answered';
    const corrDisp = corrOpt && !corrOpt.text.startsWith('Option') ? `(${corrOpt.id}) ${corrOpt.text}` : `Option ${corrOptId}`;

    const isCorrect = Boolean(userOptId && corrOptId && userOptId === corrOptId);
    return { isCorrect, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
  }

  // 8. Text / Word / Letter Answers
  const cleanUser = String(selectedOption || '').trim();
  const cleanCorr = correctRaw.trim();

  // If correct is a single letter e.g. "D" or "L"
  if (cleanCorr.length === 1) {
    const isCorrect = cleanUser.toUpperCase() === cleanCorr.toUpperCase();
    return {
      isCorrect,
      userDisplayAnswer: cleanUser.toUpperCase(),
      correctDisplayAnswer: cleanCorr.toUpperCase(),
    };
  }

  // Exact match (case insensitive, trimmed)
  const isCorrect = cleanUser.toLowerCase() === cleanCorr.toLowerCase();
  return {
    isCorrect,
    userDisplayAnswer: cleanUser,
    correctDisplayAnswer: cleanCorr,
  };
}

function formatCorrectDisplay(question: Question, correctRaw: string): string {
  if (question.type === 'two_part_letter' || question.type === 'two_part_number') {
    const parts = parseTwoPart(correctRaw);
    return parts ? `${parts[0]}, ${parts[1]}` : correctRaw;
  }
  if (question.type === 'multi_dropdown') {
    const corrIds = (correctRaw.match(/\d+/g) || []).map(String);
    const corrWords: string[] = [];
    if (question.dropdownGroups) {
      corrIds.forEach((id, gIdx) => {
        const grp = question.dropdownGroups?.[gIdx];
        const opt = grp?.options.find((o) => o.id === id);
        corrWords.push(opt ? opt.text : id);
      });
    }
    return `${corrWords.join(', ')} (Options: ${corrIds.join(', ')})`;
  }
  if (question.type === 'numerical') {
    return `Missing Digit: ${correctRaw}`;
  }
  if (question.type === 'single_choice') {
    const optId = extractOptionId(correctRaw);
    const opt = question.options?.find((o) => o.id === optId);
    if (opt && !opt.text.startsWith('Option')) {
      return `(${opt.id}) ${opt.text}`;
    }
    return `Option ${optId}`;
  }
  return correctRaw;
}
