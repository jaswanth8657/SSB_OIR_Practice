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

    let status: 'correct' | 'incorrect' | 'unanswered' = 'unanswered';
    if (userAns && userAns.isAnswered) {
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

  const filteredQuestions = questionsWithEval.filter((item) => {
    if (activeFilter === 'correct') return item.status === 'correct';
    if (activeFilter === 'incorrect') return item.status === 'incorrect';
    if (activeFilter === 'unanswered') return item.status === 'unanswered';
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 shadow-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {onBackToResults ? (
              <button
                onClick={onBackToResults}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Results</span>
              </button>
            ) : null}
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition cursor-pointer"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>
            <h1 className="text-base sm:text-lg font-bold text-white">
              Solutions & Explanations – <span className="text-blue-400">SET {pad}</span>
            </h1>
          </div>

          {/* Quick Counter */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              {correctCount} Correct
            </span>
            <span className="px-2.5 py-1 rounded-md bg-rose-950/60 text-rose-400 border border-rose-800/60">
              {incorrectCount} Incorrect
            </span>
            <span className="px-2.5 py-1 rounded-md bg-amber-950/60 text-amber-400 border border-amber-800/60">
              {unansweredCount} Unanswered
            </span>
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center gap-2 overflow-x-auto py-2 border-t border-slate-800/60 text-xs font-semibold">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeFilter === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            All Questions ({questions.length})
          </button>
          <button
            onClick={() => setActiveFilter('correct')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeFilter === 'correct'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Correct ({correctCount})</span>
          </button>
          <button
            onClick={() => setActiveFilter('incorrect')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeFilter === 'incorrect'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-rose-400 hover:bg-slate-800'
            }`}
          >
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>Incorrect ({incorrectCount})</span>
          </button>
          <button
            onClick={() => setActiveFilter('unanswered')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeFilter === 'unanswered'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Unanswered ({unansweredCount})</span>
          </button>
        </div>
      </header>

      {/* Main Solution Feed */}
      <main className="max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {filteredQuestions.length === 0 ? (
          <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-3">
            <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-300">
              No questions found for this filter
            </h3>
            <p className="text-xs text-slate-500">
              Try switching back to &apos;All Questions&apos; to view all 50 items.
            </p>
          </div>
        ) : (
          filteredQuestions.map(({ question: q, userAns, evalRes, status }) => {
            const isCorrect = status === 'correct';
            const isIncorrect = status === 'incorrect';
            const isUnanswered = status === 'unanswered';

            const cardBorderColor = isCorrect
              ? 'border-emerald-800/60 bg-emerald-950/10'
              : isIncorrect
              ? 'border-rose-800/60 bg-rose-950/10'
              : 'border-amber-800/60 bg-amber-950/10';

            const statusBadge = isCorrect ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>Correct</span>
              </span>
            ) : isIncorrect ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold">
                <XCircle className="w-3 h-3 text-rose-400" />
                <span>Incorrect</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold">
                <HelpCircle className="w-3 h-3 text-amber-400" />
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
                className={`border rounded-2xl p-5 sm:p-7 shadow-lg space-y-4 transition ${cardBorderColor}`}
              >
                {/* Question Top Row */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 text-white font-mono font-extrabold flex items-center justify-center text-sm shadow">
                      {q.questionNumber}
                    </span>
                    <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                      Question {q.questionNumber} of 50
                    </span>
                  </div>
                  <div>{statusBadge}</div>
                </div>

                {/* Source Discrepancy Alert Banner if present */}
                {q.hasSourceDiscrepancy && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold text-amber-300">
                        Source Material Discrepancy Notice:
                      </div>
                      <p className="text-amber-200/90 leading-relaxed">
                        {q.sourceDiscrepancyNote ||
                          'Question statement and answer key have an apparent source discrepancy in the original test material. The original question and official answer key are faithfully preserved as published.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Question Statement */}
                <div className="space-y-2">
                  {q.instruction && (
                    <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-900/40 text-blue-300 text-xs">
                      <strong>Instruction:</strong> {q.instruction}
                    </div>
                  )}
                  <p className="text-sm sm:text-base font-semibold text-slate-100 leading-relaxed whitespace-pre-line">
                    {q.statement}
                  </p>
                </div>

                {/* Original Question Diagrams */}
                {q.images && q.images.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Question Diagram ({q.images.length})</span>
                      <span className="text-blue-400 flex items-center gap-1">
                        <ZoomIn className="w-3 h-3" /> Click to enlarge
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3 bg-white/95 p-3 rounded-xl border border-slate-700 shadow-inner">
                      {q.images.map((imgSrc, iIdx) => (
                        <div
                          key={iIdx}
                          onClick={() => setZoomedImage(imgSrc)}
                          className="cursor-pointer group relative overflow-hidden rounded-lg hover:ring-2 hover:ring-blue-500 transition"
                        >
                          <img
                            src={imgSrc}
                            alt={`Q${q.questionNumber} Diagram ${iIdx + 1}`}
                            className="max-h-40 sm:max-h-48 object-contain"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* User Answer vs Correct Answer Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {/* User Selection */}
                  <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                    isCorrect
                      ? 'bg-emerald-950/30 border-emerald-800/40'
                      : isIncorrect
                      ? 'bg-rose-950/30 border-rose-800/40'
                      : 'bg-slate-800/60 border-slate-700/60'
                  }`}>
                    <span className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">
                      Your Answer:
                    </span>
                    <div className={`text-sm font-semibold font-mono ${
                      isCorrect
                        ? 'text-emerald-400'
                        : isIncorrect
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}>
                      {evalRes.userDisplayAnswer}
                    </div>
                  </div>

                  {/* Correct Answer */}
                  <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-700/50 text-xs space-y-1">
                    <span className="text-[11px] text-emerald-400/80 uppercase font-bold tracking-wider">
                      Official Correct Answer:
                    </span>
                    <div className="text-sm font-bold text-emerald-300 font-mono flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>{evalRes.correctDisplayAnswer}</span>
                    </div>
                  </div>
                </div>

                {/* Explanation Section */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Official Solution & Explanation:</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed whitespace-pre-line text-xs sm:text-sm">
                    {q.explanation || 'Refer to the question diagram and options.'}
                  </p>

                  {/* Solution Diagrams if present */}
                  {allSolutionImages.length > 0 && (
                    <div className="pt-2 space-y-2">
                      <div className="text-[11px] text-slate-400 flex items-center justify-between">
                        <span>Solution Diagram ({allSolutionImages.length}):</span>
                        <span className="text-emerald-400 flex items-center gap-1">
                          <ZoomIn className="w-3 h-3" /> Click to enlarge
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-slate-700">
                        {allSolutionImages.map((solImg, sIdx) => (
                          <div
                            key={sIdx}
                            onClick={() => setZoomedImage(solImg)}
                            className="cursor-pointer bg-white p-1 rounded-lg border border-slate-200 hover:ring-2 hover:ring-emerald-500 transition"
                          >
                            <img
                              src={solImg}
                              alt={`Q${q.questionNumber} Solved Diagram ${sIdx + 1}`}
                              className="max-h-36 sm:max-h-44 object-contain"
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
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-4 rounded-2xl shadow-2xl overflow-auto">
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
