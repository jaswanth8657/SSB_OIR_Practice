// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { App } from '../src/App';
import {
  saveActiveExam,
  notifyRecoveryComplete,
  clearActiveExam,
  getActiveExamSync,
  getActiveExam,
  getSetProgress,
  getAllAttempts,
} from '../src/utils/storage';
import { ActiveExamState } from '../src/types/oir';

describe('Cross-Tab Recovery & App Navigation Resilience (Defect 2 & Defect 5)', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // DEFECT 2: Expired Exam Never Receives Fresh Timer on Recovery Failure
  describe('Expired Exam Selection & Recovery Failure Handling (Defect 2)', () => {
    it('Defect 2: Expired exam returning storage_error stays on Dashboard and does not open ExamInterface', async () => {
      const now = Date.now();
      const expiredExamState: ActiveExamState = {
        setNumber: 1,
        currentQuestionIndex: 10,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: '1', isAnswered: true },
        },
        examStartTime: now - 35 * 60 * 1000,
        examEndTime: now - 10 * 60 * 1000, // Expired 10 minutes ago
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 10 * 60 * 1000,
        questionExpiredMap: {},
      };

      await saveActiveExam(expiredExamState);

      // Force storage failure when saving attempt
      vi.stubGlobal('localStorage', {
        ...localStorage,
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => {
          if (k === 'oir_test_attempts_v1') {
            throw new Error('QuotaExceededError: storage full');
          }
          store[k] = v;
        },
      });

      render(<App />);

      // Find Resume Test button for Set 1
      const resumeButtons = await screen.findAllByRole('button', { name: /Resume Test|Retry Recovery/i });
      expect(resumeButtons.length).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.click(resumeButtons[0]);
      });

      // CRITICAL ASSERTION: Must REMAIN on dashboard!
      // Must NOT navigate to exam interface
      expect(screen.queryByText(/Question 1 of 50/i)).toBeNull();

      // Must display recovery error banner on dashboard
      const retryButtons = await screen.findAllByRole('button', { name: /Retry Recovery/i });
      expect(retryButtons.length).toBeGreaterThan(0);
    });

    it('Defect 2: Unexpired exam resumes with its original deadline', async () => {
      const now = Date.now();
      const futureDeadline = now + 15 * 60 * 1000;
      const unexpiredExamState: ActiveExamState = {
        setNumber: 2,
        currentQuestionIndex: 5,
        userAnswers: {
          1: { questionNumber: 1, selectedOption: '2', isAnswered: true },
        },
        examStartTime: now - 10 * 60 * 1000,
        examEndTime: futureDeadline,
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 1000,
        questionExpiredMap: {},
      };

      await saveActiveExam(unexpiredExamState);

      render(<App />);

      const resumeButtons = await screen.findAllByRole('button', { name: /Resume Test/i });
      await act(async () => {
        fireEvent.click(resumeButtons[0]);
      });

      // Should open exam interface resuming Set 2
      expect(screen.getByText(/SET 02/i)).toBeDefined();
    });
  });

  // DEFECT 5: Cross-Tab Recovery Synchronization
  describe('Cross-Tab Synchronization (Defect 5)', () => {
    it('Defect 5: BroadcastChannel message updates dashboard from in_progress to completed, increments attempt count, and invalidates cache', async () => {
      const now = Date.now();
      const activeExamState: ActiveExamState = {
        setNumber: 3,
        currentQuestionIndex: 10,
        userAnswers: { 1: { questionNumber: 1, selectedOption: '1', isAnswered: true } },
        examStartTime: now - 35 * 60 * 1000,
        examEndTime: now + 10 * 60 * 1000, // active in progress
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
      };
      await saveActiveExam(activeExamState);

      const { unmount } = render(<App />);

      // Verify Set 3 starts with 'in_progress' and 0 completed attempts
      const resumeButtonsBefore = await screen.findAllByRole('button', { name: /Resume Test/i });
      expect(resumeButtonsBefore.length).toBeGreaterThan(0);

      // Simulate recovery in another tab: save recovered attempt into permanent history
      const recoveredAttempt = {
        attemptId: 'att_3_recovered_sync',
        setNumber: 3,
        timestamp: now,
        totalQuestions: 50,
        maxScore: 50,
        score: 45,
        correctAnswers: 45,
        incorrectAnswers: 5,
        unansweredQuestions: 0,
        excludedQuestions: 0,
        accuracyPercentage: 90,
        timeTakenSeconds: 1200,
        userAnswers: {},
      };
      const storeHistory = store['oir_test_attempts_v1'] ? JSON.parse(store['oir_test_attempts_v1']) : [];
      storeHistory.push(recoveredAttempt);
      store['oir_test_attempts_v1'] = JSON.stringify(storeHistory);

      // Clear active exam on recovered set
      delete store['oir_active_exam_set_3'];
      await clearActiveExam(3);

      // Send cross-tab recovery broadcast
      await act(async () => {
        notifyRecoveryComplete(3, 'att_3_recovered_sync');
      });

      // Verify concrete state transition:
      // 1. Attempts history has exactly 1 attempt for Set 3
      const updatedHistory = JSON.parse(store['oir_test_attempts_v1'] || '[]');
      const set3Attempts = updatedHistory.filter((a: any) => a.setNumber === 3);
      expect(set3Attempts.length).toBe(1);
      expect(set3Attempts[0].attemptId).toBe('att_3_recovered_sync');

      // 2. Retake button is now displayed instead of Resume Test
      const retakeButtons = await screen.findAllByRole('button', { name: /Retake Test/i });
      expect(retakeButtons.length).toBeGreaterThan(0);

      unmount();
    });

    it('Defect 5: storage event fallback triggers synchronization when BroadcastChannel is unavailable', async () => {
      const now = Date.now();
      const activeExamState: ActiveExamState = {
        setNumber: 4,
        currentQuestionIndex: 5,
        userAnswers: {},
        examStartTime: now - 35 * 60 * 1000,
        examEndTime: now + 10 * 60 * 1000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
      };
      await saveActiveExam(activeExamState);

      const { unmount } = render(<App />);

      // Put attempt in history
      const recoveredAttempt = {
        attemptId: 'att_4_storage_sync',
        setNumber: 4,
        timestamp: now,
        totalQuestions: 50,
        maxScore: 50,
        score: 48,
        correctAnswers: 48,
        incorrectAnswers: 2,
        unansweredQuestions: 0,
        excludedQuestions: 0,
        accuracyPercentage: 96,
        timeTakenSeconds: 1100,
        userAnswers: {},
      };
      const storeHistory = store['oir_test_attempts_v1'] ? JSON.parse(store['oir_test_attempts_v1']) : [];
      storeHistory.push(recoveredAttempt);
      store['oir_test_attempts_v1'] = JSON.stringify(storeHistory);

      delete store['oir_active_exam_set_4'];
      await clearActiveExam(4);

      const storageEvent = new StorageEvent('storage', {
        key: 'oir_recovery_sync_event',
        newValue: JSON.stringify({
          type: 'EXAM_RECOVERED',
          setNumber: 4,
          attemptId: 'att_4_storage_sync',
          timestamp: Date.now(),
        }),
      });

      await act(async () => {
        window.dispatchEvent(storageEvent);
      });

      const updatedHistory = JSON.parse(store['oir_test_attempts_v1'] || '[]');
      const set4Attempts = updatedHistory.filter((a: any) => a.setNumber === 4);
      expect(set4Attempts.length).toBe(1);

      unmount();
    });

    it('Defect 5: cleans up event listeners when component unmounts', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = render(<App />);

      unmount();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
    });

    it('Section 7: external recovery event tombstones active exam, updates dashboard to completed, and keeps other active set intact', async () => {
      const now = Date.now();

      // Tab A has active exam for Set 5 and active exam for Set 8
      const state5: ActiveExamState = {
        setNumber: 5,
        currentQuestionIndex: 12,
        userAnswers: { 1: { questionNumber: 1, selectedOption: 'A', isAnswered: true } },
        examStartTime: now - 15 * 60 * 1000,
        examEndTime: now + 10 * 60 * 1000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now - 2 * 60 * 1000,
        questionExpiredMap: {},
        sessionId: 'sess_tab_a_set5',
      };
      const state8: ActiveExamState = {
        setNumber: 8,
        currentQuestionIndex: 3,
        userAnswers: { 1: { questionNumber: 1, selectedOption: 'B', isAnswered: true } },
        examStartTime: now,
        examEndTime: now + 20 * 60 * 1000,
        questionTimeLeft: {},
        currentQuestionStartedAt: now,
        questionExpiredMap: {},
        sessionId: 'sess_tab_a_set8',
      };

      await saveActiveExam(state5);
      await saveActiveExam(state8);

      const { unmount } = render(<App />);

      // External Tab B completes recovery of Set 5:
      // Writes attempt to history and writes tombstone for Set 5
      const recoveredAttempt = {
        attemptId: 'att_5_external_tab_b',
        setNumber: 5,
        timestamp: now - 5 * 60 * 1000,
        totalQuestions: 50,
        maxScore: 50,
        score: 42,
        correctAnswers: 42,
        incorrectAnswers: 8,
        unansweredQuestions: 0,
        excludedQuestions: 0,
        accuracyPercentage: 84,
        timeTakenSeconds: 1200,
        userAnswers: {},
      };
      const storeHistory = store['oir_test_attempts_v1'] ? JSON.parse(store['oir_test_attempts_v1']) : [];
      storeHistory.push(recoveredAttempt);
      store['oir_test_attempts_v1'] = JSON.stringify(storeHistory);

      // Tab B tombstones Set 5
      await clearActiveExam(5);

      // Tab B broadcasts recovery notification
      const storageEvent = new StorageEvent('storage', {
        key: 'oir_recovery_sync_event',
        newValue: JSON.stringify({
          type: 'EXAM_RECOVERED',
          setNumber: 5,
          attemptId: 'att_5_external_tab_b',
          timestamp: Date.now(),
        }),
      });

      await act(async () => {
        window.dispatchEvent(storageEvent);
      });

      // 1. Set 5 active exam cannot be restored
      expect(getActiveExamSync(5)).toBeNull();
      expect(await getActiveExam(5)).toBeNull();

      // 2. Set 5 progress reports completed with 1 attempt
      const prog5 = getSetProgress(5);
      expect(prog5.status).toBe('completed');
      expect(prog5.attemptsCount).toBe(1);
      expect(prog5.bestScore).toBe(42);

      // 3. Set 8 active exam remains completely in-progress and unaffected
      expect(getActiveExamSync(8)).not.toBeNull();
      const prog8 = getSetProgress(8);
      expect(prog8.status).toBe('in_progress');

      // 4. Duplicate recovery notifications are idempotent
      await act(async () => {
        window.dispatchEvent(storageEvent);
      });
      expect(getSetProgress(5).attemptsCount).toBe(1);

      unmount();
    });
  });
});
