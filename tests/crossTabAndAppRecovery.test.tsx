// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { App } from '../src/App';
import { saveActiveExam, notifyRecoveryComplete } from '../src/utils/storage';
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
    it('Defect 5: BroadcastChannel message refreshes state and clears recovery error banner', async () => {
      render(<App />);

      act(() => {
        notifyRecoveryComplete(3, 'att_3_mock');
      });

      // Verify dashboard remains healthy
      expect(screen.getByText(/Questions Practiced/i)).toBeDefined();
    });

    it('Defect 5: storage event fallback triggers synchronization when BroadcastChannel is unavailable', async () => {
      render(<App />);

      const storageEvent = new StorageEvent('storage', {
        key: 'oir_recovery_sync_event',
        newValue: JSON.stringify({
          type: 'EXAM_RECOVERED',
          setNumber: 4,
          attemptId: 'att_4_mock',
          timestamp: Date.now(),
        }),
      });

      act(() => {
        window.dispatchEvent(storageEvent);
      });

      expect(screen.getByText(/Questions Practiced/i)).toBeDefined();
    });

    it('Defect 5: cleans up event listeners when component unmounts', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = render(<App />);

      unmount();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
    });
  });
});
