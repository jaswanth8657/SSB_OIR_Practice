import { Question, UserAnswer } from '../types/oir';

export interface EvaluationResult {
  isCorrect: boolean;
  isExcluded?: boolean;
  userDisplayAnswer: string;
  correctDisplayAnswer: string;
}

/**
 * Parses numeric strings including fractions (e.g. "1/2") or decimals ("0.5").
 * Rejects non-numeric, infinity, NaN, or strings with extra text.
 */
export function parseNumericValue(val: string): number | null {
  if (typeof val !== 'string') return null;
  const clean = val.trim();
  if (!clean) return null;

  // Fractions e.g. "1/2", "-3/4"
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 2) {
      const numStr = parts[0].trim();
      const denStr = parts[1].trim();
      // Ensure numerator is an integer (optional minus) and denominator is positive integer
      if (/^-?\d+$/.test(numStr) && /^\d+$/.test(denStr)) {
        const num = Number(numStr);
        const den = Number(denStr);
        if (den !== 0 && isFinite(num) && isFinite(den)) {
          return num / den;
        }
      }
    }
    return null;
  }

  // Strict integer or decimal: e.g. "8", "8.0", "0.5", "-4"
  // Strictly rejects "NaN", "Infinity", "+Infinity", hexadecimal, etc.
  if (!/^-?\d+(\.\d+)?$/.test(clean)) {
    return null;
  }

  const n = Number(clean);
  if (!isNaN(n) && isFinite(n)) {
    return n;
  }
  return null;
}

/**
 * Checks if two numbers are equivalent within floating-point tolerance (1e-6).
 * For numerical series, strictly rejects non-numeric or unparseable inputs
 * without falling back to string equality.
 */
export function areNumbersEquivalent(userVal: string, corrVal: string): boolean {
  const uNum = parseNumericValue(userVal);
  const cNum = parseNumericValue(corrVal);

  if (uNum !== null && cNum !== null) {
    return Math.abs(uNum - cNum) < 1e-6;
  }

  // For numerical evaluations, never fall back to string equality
  return false;
}

/**
 * TASK 1: Strict two-part numerical series parser.
 * Requires exactly two valid numerical values (integers, decimals, or fractions).
 * Strictly rejects:
 * - Additional values (e.g. "8, 13, 21", "1/2, 1/4, 1/8")
 * - Incomplete answers (e.g. "8", "8, ")
 * - Empty components (e.g. "8, , 13")
 * - Malformed fractions
 * - NaN, Infinity
 * - Arrays with length !== 2
 */
export function parseTwoPartNumber(input: unknown): [string, string] | null {
  if (input === undefined || input === null) return null;

  // 1. Direct array inputs: require exactly 2 elements
  if (Array.isArray(input)) {
    if (input.length !== 2) return null;
    const p1 = String(input[0]).trim();
    const p2 = String(input[1]).trim();
    if (!p1 || !p2) return null;
    if (parseNumericValue(p1) === null || parseNumericValue(p2) === null) {
      return null;
    }
    return [p1, p2];
  }

  const str = String(input).trim();
  if (!str) return null;

  // Check for empty comma components like "8, , 13" or trailing/leading comma
  if (str.includes(',')) {
    // Normalize adjacent comma + and: "8, and 13" -> "8, 13"
    const normalized = str.replace(/,\s*(?:and|&)\s*/gi, ',');
    const rawParts = normalized.split(',');
    // If any part is empty or length !== 2, reject immediately
    if (rawParts.length !== 2) return null;
    const p1 = rawParts[0].trim();
    const p2 = rawParts[1].trim();
    if (!p1 || !p2) return null;
    if (parseNumericValue(p1) === null || parseNumericValue(p2) === null) {
      return null;
    }
    return [p1, p2];
  }

  // Check for semicolon separator
  if (str.includes(';')) {
    const rawParts = str.split(';');
    if (rawParts.length !== 2) return null;
    const p1 = rawParts[0].trim();
    const p2 = rawParts[1].trim();
    if (!p1 || !p2) return null;
    if (parseNumericValue(p1) === null || parseNumericValue(p2) === null) {
      return null;
    }
    return [p1, p2];
  }

  // Check for "and" or "&" separator (word boundary for 'and')
  const andMatch = str.match(/\s+(?:and|&)\s+/i);
  if (andMatch) {
    const rawParts = str.split(/\s+(?:and|&)\s+/i);
    if (rawParts.length !== 2) return null;
    const p1 = rawParts[0].trim();
    const p2 = rawParts[1].trim();
    if (!p1 || !p2) return null;
    if (parseNumericValue(p1) === null || parseNumericValue(p2) === null) {
      return null;
    }
    return [p1, p2];
  }

  // Whitespace-separated: e.g. "8 13" or "1/2 1/4"
  const spaceParts = str.split(/\s+/);
  if (spaceParts.length === 2) {
    const p1 = spaceParts[0].trim();
    const p2 = spaceParts[1].trim();
    if (!p1 || !p2) return null;
    if (parseNumericValue(p1) === null || parseNumericValue(p2) === null) {
      return null;
    }
    return [p1, p2];
  }

  return null;
}

/**
 * Normalizes two-part letter answers (Question 13) into [part1, part2].
 * Accepts separators like comma, 'and', space, semicolon.
 * Rejects extra answers (must have exactly two parts).
 */
export function parseTwoPart(input: unknown): [string, string] | null {
  if (!input) return null;

  if (Array.isArray(input)) {
    if (input.length === 2) {
      const p1 = String(input[0]).trim();
      const p2 = String(input[1]).trim();
      if (p1 && p2) return [p1, p2];
    }
    return null;
  }

  const str = String(input).trim();
  if (!str) return null;

  // 1. Explicit separators: comma, 'and', '&', semicolon
  const normStr = str.replace(/,\s*(?:and|&)\s*/gi, ',');
  if (normStr.includes(',')) {
    const parts = normStr.split(',');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return [parts[0].trim(), parts[1].trim()];
    }
    return null;
  }

  if (str.includes(';')) {
    const parts = str.split(';');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return [parts[0].trim(), parts[1].trim()];
    }
    return null;
  }

  if (/\s+(?:and|&)\s+/i.test(str)) {
    const parts = str.split(/\s+(?:and|&)\s+/i);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return [parts[0].trim(), parts[1].trim()];
    }
    return null;
  }

  // 2. Whitespace separator
  const parts = str.split(/\s+/);
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return [parts[0].trim(), parts[1].trim()];
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

  // Guard: if question is excluded from scoring (Set 06 Q11)
  if (question.scoringExcluded) {
    let userDisp = 'Not Answered';
    if (twoPartAnswer) {
      userDisp = `${twoPartAnswer[0]}, ${twoPartAnswer[1]}`;
    } else if (Array.isArray(selectedOption)) {
      userDisp = selectedOption.join(', ');
    } else if (selectedOption !== undefined && selectedOption !== null) {
      userDisp = String(selectedOption);
    }
    return {
      isCorrect: false,
      isExcluded: true,
      userDisplayAnswer: userDisp,
      correctDisplayAnswer: formatCorrectDisplay(question, correctRaw) + ' (Excluded from Scoring)',
    };
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
    const userParts = twoPartAnswer
      ? parseTwoPartNumber(twoPartAnswer)
      : parseTwoPartNumber(selectedOption);
    const corrParts = parseTwoPartNumber(correctRaw);

    const rawUserStr = twoPartAnswer
      ? Array.isArray(twoPartAnswer)
        ? twoPartAnswer.join(', ')
        : String(twoPartAnswer)
      : Array.isArray(selectedOption)
      ? selectedOption.join(', ')
      : String(selectedOption || 'Incomplete');

    const userDisp = userParts ? `${userParts[0]} and ${userParts[1]}` : rawUserStr;
    const corrDisp = corrParts ? `${corrParts[0]} and ${corrParts[1]}` : correctRaw;

    if (!userParts || !corrParts) {
      return { isCorrect: false, userDisplayAnswer: userDisp, correctDisplayAnswer: corrDisp };
    }

    // Strict numerical order: first part matches first part, second part matches second part
    const isCorrect =
      areNumbersEquivalent(userParts[0], corrParts[0]) &&
      areNumbersEquivalent(userParts[1], corrParts[1]);

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
