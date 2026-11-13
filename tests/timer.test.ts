import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateQuestionRemaining,
  restoreQuestionTimerOnResume,
  switchQuestionTimer,
} from '../src/utils/timerUtils';

describe('Production Timer Engine (src/utils/timerUtils.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Initial Countdown & Progression
  it('starts with initial 40 seconds and progresses accurately', () => {
    const startTime = 1000000;
    vi.setSystemTime(startTime);

    // Initial check
    const t0 = calculateQuestionRemaining(startTime, 40, startTime);
    expect(t0.remainingSeconds).toBe(40);
    expect(t0.isExpired).toBe(false);

    // After 15 seconds
    const t15 = calculateQuestionRemaining(startTime, 40, startTime + 15000);
    expect(t15.remainingSeconds).toBe(25);
    expect(t15.isExpired).toBe(false);

    // After 40 seconds (exact deadline)
    const t40 = calculateQuestionRemaining(startTime, 40, startTime + 40000);
    expect(t40.remainingSeconds).toBe(0);
    expect(t40.isExpired).toBe(true);

    // After 45 seconds (over deadline)
    const t45 = calculateQuestionRemaining(startTime, 40, startTime + 45000);
    expect(t45.remainingSeconds).toBe(0);
    expect(t45.isExpired).toBe(true);
  });

  // 2. Refresh Restoration (Task 1)
  describe('Browser refresh restoration (Task 1)', () => {
    it('resumes with remaining time when user refreshes mid-question', () => {
      const qStart = 1000000;
      vi.setSystemTime(qStart + 15000); // 15s elapsed

      // Initial budget was 40s
      const initialTimeLeft = { 1: 40 };
      const initialExpiredMap = {};

      const restored = restoreQuestionTimerOnResume(
        1,
        initialTimeLeft,
        qStart,
        initialExpiredMap,
        40,
        qStart + 15000
      );

      // Must have ~25 seconds remaining, NOT 40 seconds
      expect(restored.remainingSeconds).toBe(25);
      expect(restored.isExpired).toBe(false);
      expect(restored.updatedTimeLeft[1]).toBe(25);
      expect(restored.updatedExpiredMap[1]).toBe(false);
    });

    it('accounts for time spent while browser was closed (closed for another 10s)', () => {
      const qStart = 1000000;
      // Closed at t=15s, reopened at t=25s (25s total elapsed)
      const reopenTime = qStart + 25000;
      vi.setSystemTime(reopenTime);

      const initialTimeLeft = { 1: 40 };
      const initialExpiredMap = {};

      const restored = restoreQuestionTimerOnResume(
        1,
        initialTimeLeft,
        qStart,
        initialExpiredMap,
        40,
        reopenTime
      );

      // Must have ~15 seconds remaining
      expect(restored.remainingSeconds).toBe(15);
      expect(restored.isExpired).toBe(false);
      expect(restored.updatedTimeLeft[1]).toBe(15);
    });

    it('marks question as expired if deadline passed while browser was closed', () => {
      const qStart = 1000000;
      // Reopened at t=45s (after 40s budget ran out)
      const reopenTime = qStart + 45000;
      vi.setSystemTime(reopenTime);

      const initialTimeLeft = { 1: 40 };
      const initialExpiredMap = {};

      const restored = restoreQuestionTimerOnResume(
        1,
        initialTimeLeft,
        qStart,
        initialExpiredMap,
        40,
        reopenTime
      );

      expect(restored.remainingSeconds).toBe(0);
      expect(restored.isExpired).toBe(true);
      expect(restored.updatedTimeLeft[1]).toBe(0);
      expect(restored.updatedExpiredMap[1]).toBe(true);
    });

    it('preserves already-expired question as locked (0 seconds)', () => {
      const now = 2000000;
      vi.setSystemTime(now);

      const initialTimeLeft = { 1: 0 };
      const initialExpiredMap = { 1: true };

      const restored = restoreQuestionTimerOnResume(
        1,
        initialTimeLeft,
        now - 10000,
        initialExpiredMap,
        40,
        now
      );

      expect(restored.remainingSeconds).toBe(0);
      expect(restored.isExpired).toBe(true);
      expect(restored.updatedTimeLeft[1]).toBe(0);
      expect(restored.updatedExpiredMap[1]).toBe(true);
    });
  });

  // 3. Navigation & Backward Retention
  describe('Navigation & timer retention', () => {
    it('grants full 40s to an unseen question on forward navigation', () => {
      const now = 1000000;
      const initialTimeLeft = { 1: 40 }; // Q2 not visited yet
      const initialExpiredMap = {};

      // User spends 15s on Q1, then navigates to Q2
      const navResult = switchQuestionTimer(
        1,
        now,
        2,
        initialTimeLeft,
        initialExpiredMap,
        40,
        now + 15000
      );

      expect(navResult.updatedTimeLeft[1]).toBe(25); // Q1 remaining saved as 25s
      expect(navResult.toQRemaining).toBe(40); // Q2 gets fresh 40s
      expect(navResult.toQExpired).toBe(false);
    });

    it('preserves remaining time on backward navigation (does NOT reset to 40s)', () => {
      const t0 = 1000000;
      // Q1 was saved with 25s remaining
      // User is on Q2 (started at t0 + 15000 with 40s budget)
      // Spends 10s on Q2, then goes back to Q1 at t0 + 25000
      const currentMap = { 1: 25, 2: 40 };
      const expiredMap = {};

      const backNavResult = switchQuestionTimer(
        2,
        t0 + 15000,
        1,
        currentMap,
        expiredMap,
        40,
        t0 + 25000
      );

      expect(backNavResult.updatedTimeLeft[2]).toBe(30); // Q2 saved with 30s remaining
      expect(backNavResult.toQRemaining).toBe(25); // Q1 restored with exact 25s remaining!
      expect(backNavResult.toQExpired).toBe(false);
    });

    it('keeps expired question locked when returning to it backwards or jumping', () => {
      const now = 1000000;
      const currentMap = { 1: 0, 2: 30 };
      const expiredMap = { 1: true };

      const navResult = switchQuestionTimer(
        2,
        now,
        1,
        currentMap,
        expiredMap,
        40,
        now + 5000
      );

      expect(navResult.toQRemaining).toBe(0);
      expect(navResult.toQExpired).toBe(true);
    });
  });
});
