/**
 * Timer calculation utilities for OIR Preparation Hub.
 * Uses real wall-clock timestamps to guarantee non-cheatable and refresh-safe countdowns.
 */

/**
 * Calculates the remaining time for a question based on its start timestamp and initial budget.
 */
export function calculateQuestionRemaining(
  savedStartedAt: number,
  savedBudgetSeconds: number,
  now: number = Date.now()
): { remainingSeconds: number; isExpired: boolean; elapsedSeconds: number } {
  if (savedBudgetSeconds <= 0) {
    return { remainingSeconds: 0, isExpired: true, elapsedSeconds: 0 };
  }

  const elapsedSeconds = Math.max(0, (now - savedStartedAt) / 1000);
  const remainingMs = savedBudgetSeconds * 1000 - (now - savedStartedAt);

  if (remainingMs <= 0) {
    return { remainingSeconds: 0, isExpired: true, elapsedSeconds };
  }

  return {
    remainingSeconds: Math.ceil(remainingMs / 1000),
    isExpired: false,
    elapsedSeconds,
  };
}

/**
 * Restores the active question timer when an examination is resumed after a browser refresh or pause.
 */
export function restoreQuestionTimerOnResume(
  curQNum: number,
  initialQuestionTimeLeft: Record<number, number>,
  initialStartedAt: number,
  initialExpiredMap: Record<number, boolean>,
  defaultQuestionSeconds: number,
  now: number = Date.now()
): {
  remainingSeconds: number;
  isExpired: boolean;
  updatedTimeLeft: Record<number, number>;
  updatedExpiredMap: Record<number, boolean>;
  newStartedAt: number;
} {
  // If the question was already flagged as expired, it must remain permanently expired
  if (initialExpiredMap[curQNum]) {
    return {
      remainingSeconds: 0,
      isExpired: true,
      updatedTimeLeft: { ...initialQuestionTimeLeft, [curQNum]: 0 },
      updatedExpiredMap: { ...initialExpiredMap, [curQNum]: true },
      newStartedAt: now,
    };
  }

  const savedBudget = initialQuestionTimeLeft[curQNum] ?? defaultQuestionSeconds;
  const { remainingSeconds, isExpired } = calculateQuestionRemaining(
    initialStartedAt,
    savedBudget,
    now
  );

  const updatedTimeLeft = {
    ...initialQuestionTimeLeft,
    [curQNum]: remainingSeconds,
  };
  const updatedExpiredMap = {
    ...initialExpiredMap,
    [curQNum]: isExpired,
  };

  return {
    remainingSeconds,
    isExpired,
    updatedTimeLeft,
    updatedExpiredMap,
    newStartedAt: now,
  };
}

/**
 * Handles question switching: deducts elapsed time from the departure question
 * and prepares the timer for the destination question.
 */
export function switchQuestionTimer(
  fromQNum: number,
  fromStartedAt: number,
  toQNum: number,
  currentTimeLeftMap: Record<number, number>,
  currentExpiredMap: Record<number, boolean>,
  defaultQuestionSeconds: number,
  now: number = Date.now()
): {
  updatedTimeLeft: Record<number, number>;
  updatedExpiredMap: Record<number, boolean>;
  toQRemaining: number;
  toQExpired: boolean;
  newStartedAt: number;
} {
  // 1. Calculate remaining on departure question
  const fromBudget = currentTimeLeftMap[fromQNum] ?? defaultQuestionSeconds;
  const { remainingSeconds: fromRemaining, isExpired: fromExpired } =
    calculateQuestionRemaining(fromStartedAt, fromBudget, now);

  const updatedTimeLeft = {
    ...currentTimeLeftMap,
    [fromQNum]: fromRemaining,
  };

  const updatedExpiredMap = {
    ...currentExpiredMap,
    [fromQNum]: currentExpiredMap[fromQNum] || fromExpired,
  };

  // 2. Prepare destination question
  const toExpired = Boolean(updatedExpiredMap[toQNum]);
  let toQRemaining = 0;

  if (toExpired) {
    toQRemaining = 0;
    updatedTimeLeft[toQNum] = 0;
  } else {
    // If unseen, grant default question seconds. If seen, restore saved remaining time.
    toQRemaining = updatedTimeLeft[toQNum] ?? defaultQuestionSeconds;
    updatedTimeLeft[toQNum] = toQRemaining;
  }

  return {
    updatedTimeLeft,
    updatedExpiredMap,
    toQRemaining,
    toQExpired: toExpired,
    newStartedAt: now,
  };
}
