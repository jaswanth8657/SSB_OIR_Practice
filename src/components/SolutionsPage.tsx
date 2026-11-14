import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ZoomIn,
  X,
  BookOpen,
  Check,
  LayoutDashboard,
  AlertTriangle,
  Info,
  ShieldAlert,
  HelpCircle as QuestionIcon,
} from 'lucide-react';
import { Question, TestAttempt } from '../types/oir';
import { evaluateAnswer } from '../utils/evaluator';

interface SolutionsPageProps {
  setNumber: number;
  questions: Question[];
  attempt?: TestAttempt;
  onBackToResults?: () => void;
  onBackToDashboard: () => void;
}

export const SolutionsPage: React.FC<SolutionsPageProps> = ({
  setNumber,
  questions,
  attempt,
  onBackToResults,
  onBackToDashboard,
}) => {
  const pad = setNumber.toString().padStart(2, '0');
  const [activeFilter, setActiveFilter] = useState<'all' | 'correct' | 'incorrect' | 'unanswered'>('all');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Evaluate each question with user answer
  const questionsWithEval = questions.map((q) => {
    const userAns = attempt?.userAnswers[q.questionNumber];
    const evalRes = evaluateAnswer(
      q,
      userAns?.selectedOption,
      userAns?.twoPartAnswer,
      userAns?.dropdownSelection
    );

    let status: 'correct' | 'incorrect' | 'unanswered' | 'excluded' = 'unanswered';
    if (q.scoringExcluded) {
      status = 'excluded';
    } else if (userAns && userAns.isAnswered) {
      status = evalRes.isCorrect ? 'correct' : 'incorrect';
    }

    return {
      question: q,
      userAns,
      evalRes,
      status,
    };
  });

  const correctCount = questionsWithEval.filter((q) => q.status === 'correct').length;
  const incorrectCount = questionsWithEval.filter((q) => q.status === 'incorrect').length;
  const unansweredCount = questionsWithEval.filter((q) => q.status === 'unanswered').length;
  const excludedCount = questionsWithEval.filter((q) => q.status === 'excluded').length;

  const filteredQuestions = questionsWithEval.filter((item) => {
    if (activeFilter === 'correct') return item.status === 'correct';
    if (activeFilter === 'incorrect') return item.status === 'incorrect';
    if (activeFilter === 'unanswered') return item.status === 'unanswered' || item.status === 'excluded';
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {onBackToResults ? (
              <button
                onClick={onBackToResults}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 text-xs font-semibold transition cursor-pointer shadow-sm"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Results</span>
              </button>
            ) : null}
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 text-xs font-semibold transition cursor-pointer shadow-sm"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-blue-600" />
              <span>Dashboard</span>
            </button>
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900">
              Solutions & Explanations – <span className="text-blue-600">SET {pad}</span>
            </h1>
          </div>

          {/* Quick Counter */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
              {correctCount} Correct
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 font-bold">
              {incorrectCount} Incorrect
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-bold">
              {unansweredCount} Unanswered
            </span>
            {excludedCount > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-800 border border-purple-200 font-bold">
                {excludedCount} Excluded
              </span>
            )}
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center gap-2 overflow-x-auto py-2.5 border-t border-slate-200 text-xs font-bold">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              activeFilter === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            All Questions ({questions.length})
          </button>
          <button
            onClick={() => setActiveFilter('correct')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              activeFilter === 'correct'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-emerald-700 hover:bg-slate-100'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Correct ({correctCount})</span>
          </button>
          <button
            onClick={() => setActiveFilter('incorrect')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              activeFilter === 'incorrect'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-rose-700 hover:bg-slate-100'
            }`}
          >
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>Incorrect ({incorrectCount})</span>
          </button>
          <button
            onClick={() => setActiveFilter('unanswered')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              activeFilter === 'unanswered'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-amber-700 hover:bg-slate-100'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
            <span>Unanswered ({unansweredCount})</span>
          </button>
        </div>
      </header>

      {/* Main Solution Feed */}
      <main className="max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {filteredQuestions.length === 0 ? (
          <div className="text-center py-16 bg-white border border-slate-200 rounded-3xl p-8 space-y-3 shadow-sm">
            <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
            <h3 className="text-base font-bold text-slate-700">
              No questions found for this filter
            </h3>
            <p className="text-xs text-slate-500">
              Try switching back to &apos;All Questions&apos; to view all 50 items.
            </p>
          </div>
        ) : (
          filteredQuestions.map(({ question: q, userAns, evalRes, status }) => {
            const isExcluded = q.scoringExcluded || status === 'excluded';
            const isCorrect = status === 'correct';
            const isIncorrect = status === 'incorrect';
            const isUnanswered = status === 'unanswered';

            const cardBorderColor = isExcluded
              ? 'border-purple-200 bg-white'
              : isCorrect
              ? 'border-emerald-200 bg-white'
              : isIncorrect
              ? 'border-rose-200 bg-white'
              : 'border-slate-200 bg-white';

            const statusBadge = isExcluded ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-xs font-bold">
                <ShieldAlert className="w-3 h-3 text-purple-600" />
                <span>Excluded from Scoring</span>
              </span>
            ) : isCorrect ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>Correct</span>
              </span>
            ) : isIncorrect ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold">
                <XCircle className="w-3 h-3 text-rose-600" />
                <span>Incorrect</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold">
                <HelpCircle className="w-3 h-3 text-amber-600" />
                <span>Unanswered</span>
              </span>
            );

            // Collect all solution images
            const allSolutionImages = q.solutionImages && q.solutionImages.length > 0
              ? q.solutionImages
              : q.solutionImage
              ? [q.solutionImage]
              : [];

            return (
              <div
                key={q.questionNumber}
                className={`border rounded-3xl p-5 sm:p-7 shadow-sm space-y-4 transition ${cardBorderColor}`}
              >
                {/* Question Top Row */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 font-mono font-extrabold flex items-center justify-center text-sm shadow-sm">
                      {q.questionNumber}
                    </span>
                    <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                      Question {q.questionNumber} of 50
                    </span>
                  </div>
                  <div>{statusBadge}</div>
                </div>

                {/* TASK 4: Excluded From Scoring Banner */}
                {isExcluded && (
                  <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-start gap-3 shadow-sm">
                    <ShieldAlert className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold text-purple-800 text-sm">
                        Excluded from Scoring:
                      </div>
                      <p className="text-purple-800/90 leading-relaxed">
                        {q.scoringExclusionReason ||
                          'This question has ambiguous options in the source reference key. It is excluded from automatic scoring to ensure fair grading, and does not count against your final score or accuracy calculation.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Source Discrepancy Alert Banner if present (and not already highlighted by exclusion banner) */}
                {q.hasSourceDiscrepancy && !isExcluded && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shadow-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold text-amber-800">
                        Source Material Discrepancy Notice:
                      </div>
                      <p className="text-amber-800/90 leading-relaxed">
                        {q.sourceDiscrepancyNote ||
                          'Question statement and answer key have an apparent source discrepancy in the original test material. The original question and official answer key are faithfully preserved as published.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Question Statement */}
                <div className="space-y-2">
                  {q.instruction && (
                    <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs">
                      <strong>Instruction:</strong> {q.instruction}
                    </div>
                  )}
                  <p className="text-sm sm:text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                    {q.statement}
                  </p>
                </div>

                {/* Original Question Diagrams */}
                {q.images && q.images.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] text-slate-500 flex items-center justify-between">
                      <span>Question Diagram ({q.images.length})</span>
                      <span className="text-blue-600 flex items-center gap-1 font-semibold">
                        <ZoomIn className="w-3 h-3" /> Click to enlarge
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                      {q.images.map((imgSrc, iIdx) => (
                        <div
                          key={iIdx}
                          onClick={() => setZoomedImage(imgSrc)}
                          className="cursor-pointer group relative overflow-hidden rounded-xl hover:ring-2 hover:ring-blue-500 transition"
                        >
                          <img
                            src={imgSrc}
                            alt={`Q${q.questionNumber} Diagram ${iIdx + 1}`}
                            className="max-h-40 sm:max-h-48 object-contain"
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* User Answer vs Correct Answer Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {/* User Selection */}
                  <div className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                    isExcluded
                      ? 'bg-slate-50 border-slate-200'
                      : isCorrect
                      ? 'bg-emerald-50 border-emerald-200'
                      : isIncorrect
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    <span className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                      Your Answer:
                    </span>
                    <div className={`text-sm font-semibold font-mono ${
                      isExcluded
                        ? 'text-purple-700'
                        : isCorrect
                        ? 'text-emerald-700'
                        : isIncorrect
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}>
                      {evalRes.userDisplayAnswer}
                    </div>
                  </div>

                  {/* Correct Answer */}
                  <div className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                    isExcluded
                      ? 'bg-purple-50 border-purple-200 text-purple-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}>
                    <span className="text-[11px] uppercase font-bold tracking-wider opacity-80">
                      {isExcluded
                        ? 'Official Answer Key (Unverified Source Entry):'
                        : 'Official Correct Answer:'}
                    </span>
                    <div className="text-sm font-bold font-mono flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>{evalRes.correctDisplayAnswer}</span>
                    </div>
                  </div>
                </div>

                {/* Explanation Section */}
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider">
                    <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                    <span>Official Solution & Explanation:</span>
                  </div>

                  {/* TASK 7: Missing Source Explanation Notice */}
                  {q.hasMissingSourceExplanation ? (
                    <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-start gap-2.5">
                      <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <p className="leading-relaxed font-medium">
                        The original reference booklet provides the correct answer but does not include a written explanation for this question.
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-700 leading-relaxed whitespace-pre-line text-xs sm:text-sm">
                      {q.explanation || 'Refer to the question diagram and options.'}
                    </p>
                  )}

                  {/* Solution Diagrams if present */}
                  {allSolutionImages.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <div className="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>Solution Diagram ({allSolutionImages.length}):</span>
                        <span className="text-emerald-700 flex items-center gap-1 font-semibold">
                          <ZoomIn className="w-3 h-3" /> Click to enlarge
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
                        {allSolutionImages.map((solImg, sIdx) => (
                          <div
                            key={sIdx}
                            onClick={() => setZoomedImage(solImg)}
                            className="cursor-pointer bg-white p-1 rounded-xl border border-slate-200 hover:ring-2 hover:ring-emerald-500 transition"
                          >
                            <img
                              src={solImg}
                              alt={`Q${q.questionNumber} Solved Diagram ${sIdx + 1}`}
                              className="max-h-36 sm:max-h-44 object-contain"
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* Lightbox / Zoom Modal */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md cursor-zoom-out"
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-4 rounded-3xl shadow-2xl overflow-auto">
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomedImage}
              alt="Enlarged Diagram"
              className="w-full h-auto object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
};
