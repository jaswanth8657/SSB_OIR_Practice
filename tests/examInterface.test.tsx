// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExamInterface } from '../src/components/ExamInterface';
import { Question, UserSettings, ActiveExamState } from '../src/types/oir';
import { getActiveExamSync } from '../src/utils/storage';

describe('ExamInterface Component Integration (src/components/ExamInterface.tsx)', () => {
  const mockSettings: UserSettings = {
    questionTimeSeconds: 40,
    totalDurationMinutes: 25,
    soundEnabled: false,
  };

  const mockQuestions: Question[] = [
    {
      id: 1,
      setNumber: 1,
      questionNumber: 1,
      statement: 'First question statement',
      type: 'single_choice',
      images: [],
      options: [
        { id: '1', text: 'Option A' },
        { id: '2', text: 'Option B' },
      ],
      correctAnswer: '(1)',
      explanation: 'First explanation',
    },
    {
      id: 2,
      setNumber: 1,
      questionNumber: 2,
      statement: 'Second question statement',
      type: 'single_choice',
      images: [],
      options: [
        { id: '1', text: 'Choice X' },
        { id: '2', text: 'Choice Y' },
      ],
      correctAnswer: '(2)',
      explanation: 'Second explanation',
    },
    {
      id: 3,
      setNumber: 1,
      questionNumber: 3,
      statement: 'Third numerical sequence',
      type: 'two_part_number',
      images: [],
      options: [],
      correctAnswer: '8 and 13',
      explanation: 'Numerical explanation',
    },
    {
      id: 11,
      setNumber: 6,
      questionNumber: 11,
      statement: 'Set 06 Question 11 discrepancy statement',
      type: 'single_choice',
      images: [],
      options: [{ id: '1', text: 'Option 1' }],
      correctAnswer: 'N',
      scoringExcluded: true,
      scoringExclusionReason: 'Ambiguous source answer key',
      hasSourceDiscrepancy: true,
      sourceDiscrepancyNote: 'Source key mismatch',
    },
  ];

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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // 1 & 2: Starts with configured question time & overall duration
  it('renders with configured question timer and overall duration', () => {
    act(() => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={vi.fn()}
          onExit={vi.fn()}
        />
      );
    });

    expect(screen.getByText(/First question statement/i)).toBeTruthy();
    // 40s per question configured
    expect(screen.getByText('40s')).toBeTruthy();
    // 25m:00s total duration configured
    expect(screen.getByText('25:00')).toBeTruthy();
  });

  // 3: Countdown decreases correctly
  it('decreases question countdown and overall countdown with elapsed time', () => {
    act(() => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={vi.fn()}
          onExit={vi.fn()}
        />
      );
    });

    act(() => {
      vi.advanceTimersByTime(5000); // 5 seconds
    });

    // 40s - 5s = 35s
    expect(screen.getByText('35s')).toBeTruthy();
    // 25:00 - 5s = 24:55
    expect(screen.getByText('24:55')).toBeTruthy();
  });

  // 4 & 5: Question timeout locks answer inputs and advances automatically
  it('automatically advances to next question when question timer expires and locks expired question', () => {
    act(() => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={vi.fn()}
          onExit={vi.fn()}
        />
      );
    });

    expect(screen.getByText(/First question statement/i)).toBeTruthy();

    // Advance 41 seconds (full question budget expired)
    act(() => {
      vi.advanceTimersByTime(41000);
    });

    // Requirement 5: Question timeout advances automatically to Question 2!
    expect(screen.getByText(/Second question statement/i)).toBeTruthy();

    // Navigate back to Question 1 to verify it remains locked at 0s (Requirement 4 & 11)
    const prevBtn = screen.getByText('Previous');
    act(() => {
      fireEvent.click(prevBtn);
    });

    expect(screen.getByText(/First question statement/i)).toBeTruthy();
    expect(screen.getByText('0s')).toBeTruthy();
    expect(screen.getByText(/Time Expired/i)).toBeTruthy();

    // Verify option inputs are disabled for expired question
    const optionButton = screen.getByText('Option A').closest('button');
    expect(optionButton?.disabled).toBe(true);
  });

  // 6 & 7: Navigation preserves question timer and previous selection
  it('preserves answer and remaining time when navigating between questions', () => {
    act(() => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={vi.fn()}
          onExit={vi.fn()}
        />
      );
    });

    // Spend 15s on Q1
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(screen.getByText('25s')).toBeTruthy();

    // Select option 1 for Q1
    const optionA = screen.getByText('Option A');
    act(() => {
      fireEvent.click(optionA);
    });

    // Navigate to Q2
    const nextBtn = screen.getByText('Next');
    act(() => {
      fireEvent.click(nextBtn);
    });

    // Q2 should have fresh 40s
    expect(screen.getByText(/Second question statement/i)).toBeTruthy();
    expect(screen.getByText('40s')).toBeTruthy();

    // Navigate back to Q1
    const prevBtn = screen.getByText('Previous');
    act(() => {
      fireEvent.click(prevBtn);
    });

    // Q1 should retain its remaining time (25s) and NOT reset to 40s!
    expect(screen.getByText(/First question statement/i)).toBeTruthy();
    expect(screen.getByText('25s')).toBeTruthy();
  });

  // 8: Refresh restoration preserves the saved deadline
  it('restores exam state and remaining question budget upon resume/refresh', () => {
    const now = Date.now();
    const savedState: ActiveExamState = {
      setNumber: 1,
      currentQuestionIndex: 0,
      userAnswers: {
        1: { questionNumber: 1, selectedOption: '1', isAnswered: true },
      },
      examStartTime: now - 10000,
      examEndTime: now + 24 * 60 * 1000,
      questionTimeLeft: { 1: 28 }, // 28s remaining when refreshed
      currentQuestionStartedAt: now - 3000, // 3s elapsed while refreshing
      questionExpiredMap: {},
    };

    act(() => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          initialState={savedState}
          onFinish={vi.fn()}
          onExit={vi.fn()}
        />
      );
    });

    // Restored remaining: 28s - 3s = 25s
    expect(screen.getByText('25s')).toBeTruthy();
  });

  // 9: Overall timeout submits the attempt
  it('automatically submits when overall exam timer reaches 0', async () => {
    const onFinish = vi.fn();
    await act(async () => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={onFinish}
          onExit={vi.fn()}
        />
      );
    });

    // Advance 25 minutes (1,500,000 ms) and flush async promises
    await act(async () => {
      vi.advanceTimersByTime(25 * 60 * 1000);
      await Promise.resolve();
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    const attempt = onFinish.mock.calls[0][0];
    expect(attempt.setNumber).toBe(1);
    expect(attempt.totalQuestions).toBe(3);
  });

  // 10: Manual submission saves the attempt
  it('submits and triggers onFinish when user manually submits exam', async () => {
    const onFinish = vi.fn();
    await act(async () => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={onFinish}
          onExit={vi.fn()}
        />
      );
    });

    // Open submit modal
    const submitBtn = screen.getByText('Submit Test');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Confirm submission
    const confirmBtn = screen.getByText('Yes, Submit Now');
    await act(async () => {
      fireEvent.click(confirmBtn);
      await Promise.resolve();
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    const attempt = onFinish.mock.calls[0][0];
    expect(attempt.setNumber).toBe(1);
  });

  // 11: Set 06 Question 11 discrepancy alert & scoring exclusion
  it('displays exclusion warning for Set 06 Q11', () => {
    act(() => {
      render(
        <ExamInterface
          setNumber={6}
          questions={[mockQuestions[3]]}
          settings={mockSettings}
          onFinish={vi.fn()}
          onExit={vi.fn()}
        />
      );
    });

    expect(screen.getByText(/Source Discrepancy Flagged:/i)).toBeTruthy();
    expect(screen.getByText(/excluded from scoring/i)).toBeTruthy();
  });

  // 12: TASK 1 - Failed manual submission preserves active exam and allows retry
  it('handles failed manual submission: retains active exam, displays error, and allows retry', async () => {
    const onFinish = vi.fn();

    // Start with storage failing on attempts key
    let failStorage = true;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => {
        if (key === 'oir_test_attempts_v1' && failStorage) {
          throw new Error('QuotaExceededError: storage full');
        }
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });

    await act(async () => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={onFinish}
          onExit={vi.fn()}
        />
      );
    });

    // Answer Q1
    await act(async () => {
      fireEvent.click(screen.getByText('Option A'));
      await Promise.resolve();
    });

    // Open submit modal & submit
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Test'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Yes, Submit Now'));
    });

    // CRITICAL: onFinish MUST NOT be called!
    expect(onFinish).not.toHaveBeenCalled();

    // CRITICAL: Active exam MUST still exist in store!
    expect(store['oir_active_exam_set_1']).toBeTruthy();

    // Error message must be visible
    expect(
      screen.getByText(
        /Your examination could not be saved because browser storage is unavailable or full/i
      )
    ).toBeTruthy();

    // Retry button must be available
    const retryBtn = screen.getByText('Retry Saving');
    expect(retryBtn).toBeTruthy();

    // Now storage becomes available again
    failStorage = false;

    // Click Retry Saving
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // onFinish is now successfully called!
    expect(onFinish).toHaveBeenCalledTimes(1);

    // Active exam state is now cleared/tombstoned from storage
    expect(getActiveExamSync(1)).toBeNull();
  });

  // 13: TASK 1 - Failed automatic overall timer expiration submission allows retry
  it('handles failed overall timer submission: retains exam, displays error modal, and retries cleanly', async () => {
    const onFinish = vi.fn();

    let failStorage = true;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => {
        if (key === 'oir_test_attempts_v1' && failStorage) {
          throw new Error('QuotaExceededError: storage full');
        }
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });

    await act(async () => {
      render(
        <ExamInterface
          setNumber={1}
          questions={mockQuestions.slice(0, 3)}
          settings={mockSettings}
          onFinish={onFinish}
          onExit={vi.fn()}
        />
      );
    });

    // Fast forward entire test duration (25 mins)
    await act(async () => {
      vi.advanceTimersByTime(25 * 60 * 1000);
      await Promise.resolve();
    });

    // Storage failed: onFinish MUST NOT be called!
    expect(onFinish).not.toHaveBeenCalled();

    // Active exam preserved
    expect(store['oir_active_exam_set_1']).toBeTruthy();

    // Submission error modal is displayed with Retry Saving button
    expect(
      screen.getByText(
        /Your examination could not be saved because browser storage is unavailable or full/i
      )
    ).toBeTruthy();

    const retryBtn = screen.getByText('Retry Saving');
    expect(retryBtn).toBeTruthy();

    // Storage issue resolved
    failStorage = false;

    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // onFinish called after successful retry
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(getActiveExamSync(1)).toBeNull();
  });
});
