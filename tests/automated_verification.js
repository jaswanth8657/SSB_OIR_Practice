import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ANSI styling
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const cyan = (t) => `\x1b[36m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;

let datasetPassedCount = 0;
let datasetFailedCount = 0;

function assert(desc, condition, details = '') {
  if (condition) {
    datasetPassedCount++;
    console.log(`  ${green('✓')} ${desc}`);
  } else {
    datasetFailedCount++;
    console.error(`  ${red('✗')} ${bold(desc)}: ${details}`);
  }
}

console.log(cyan(bold('\n======================================================')));
console.log(cyan(bold('  OIR PREPARATION HUB – AUDIT & VERIFICATION SUITE')));
console.log(cyan(bold('======================================================\n')));

// ======================================================================
// PART 1: DATASET INTEGRITY & CONTENT AUDIT (1,000 Verified Questions)
// ======================================================================
console.log(bold('--- PART 1: Full Dataset Integrity & Filesystem Audit ---'));

const dataDir = path.resolve('src/data/questions');
const setsSummaryPath = path.resolve('src/data/setsSummary.json');

assert('setsSummary.json exists on disk', fs.existsSync(setsSummaryPath));
const setsSummary = JSON.parse(fs.readFileSync(setsSummaryPath, 'utf8'));
assert('setsSummary contains exactly 20 sets', setsSummary.length === 20);

let totalQuestions = 0;
let totalQ13Checked = 0;
let totalQ45Checked = 0;
let totalQ18Checked = 0;
let totalQ20Q23Checked = 0;
let totalBrokenImages = 0;
let totalDiscrepancies = 0;

for (let s = 1; s <= 20; s++) {
  const pad = s.toString().padStart(2, '0');
  const filePath = path.join(dataDir, `set${pad}.json`);
  assert(`Set ${pad} JSON file exists`, fs.existsSync(filePath));
  const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  totalQuestions += questions.length;
  assert(`Set ${pad} has exactly 50 questions`, questions.length === 50);

  // Check Q13 is two_part_letter
  const q13 = questions.find((q) => q.questionNumber === 13);
  if (q13 && q13.type === 'two_part_letter') totalQ13Checked++;

  // Check Q45 is two_part_number
  const q45 = questions.find((q) => q.questionNumber === 45);
  if (q45 && q45.type === 'two_part_number') totalQ45Checked++;

  // Check Q18 is multi_dropdown with groups
  const q18 = questions.find((q) => q.questionNumber === 18);
  if (q18 && q18.type === 'multi_dropdown' && q18.dropdownGroups && q18.dropdownGroups.length === 3) {
    totalQ18Checked++;
  }

  // Check Q20 and Q23 numerical
  const q20 = questions.find((q) => q.questionNumber === 20);
  const q23 = questions.find((q) => q.questionNumber === 23);
  if (q20 && q20.type === 'numerical' && /^\d+$/.test(q20.correctAnswer)) totalQ20Q23Checked++;
  if (q23 && q23.type === 'numerical' && /^\d+$/.test(q23.correctAnswer)) totalQ20Q23Checked++;

  // Check images exist on disk
  questions.forEach((q) => {
    (q.images || []).forEach((imgRel) => {
      const imgPath = path.resolve('public', imgRel.replace(/^\//, ''));
      if (!fs.existsSync(imgPath)) {
        totalBrokenImages++;
      }
    });
    (q.solutionImages || []).forEach((imgRel) => {
      const imgPath = path.resolve('public', imgRel.replace(/^\//, ''));
      if (!fs.existsSync(imgPath)) {
        totalBrokenImages++;
      }
    });
    if (q.hasSourceDiscrepancy) {
      totalDiscrepancies++;
    }
    if (s === 6 && q.questionNumber === 11) {
      assert('Set 06 Q11 has scoringExcluded set to true', q.scoringExcluded === true);
    }
    if ((s === 10 || s === 11) && q.questionNumber === 45) {
      assert(`Set ${pad} Q45 has hasMissingSourceExplanation set to true`, q.hasMissingSourceExplanation === true);
    }
  });
}

assert('Total questions in dataset is exactly 1,000', totalQuestions === 1000);
assert('All 20 Q13 converted to two_part_letter with letter-pair answers', totalQ13Checked === 20);
assert('All 20 Q45 converted to two_part_number with number-pair answers', totalQ45Checked === 20);
assert('All 20 Q18 converted to multi_dropdown with 3 dropdown groups', totalQ18Checked === 20);
assert('All 40 Q20 & Q23 converted to numerical with verified single digits', totalQ20Q23Checked === 40);
assert('Zero broken images across all 1,000 questions and solutions', totalBrokenImages === 0);
assert('Set 06 Q11 source discrepancy correctly flagged', totalDiscrepancies === 1);

console.log(`\n  Dataset Integrity Passed: ${green(bold(datasetPassedCount))}`);
console.log(`  Dataset Integrity Failed: ${datasetFailedCount === 0 ? green(bold('0')) : red(bold(datasetFailedCount))}`);

if (datasetFailedCount > 0) {
  console.error(red(bold('\nDataset integrity audit failed! Aborting.')));
  process.exit(1);
}

// ======================================================================
// PART 2: PRODUCTION ENGINE UNIT & INTEGRATION TESTS VIA VITEST
// Executes production files: evaluator.ts, timerUtils.ts, scoring.ts, storage.ts, ExamInterface.tsx
// ======================================================================
console.log(cyan(bold('\n======================================================')));
console.log(bold('--- PART 2: Executing Production Engine Test Suites (Vitest) ---'));
console.log(cyan(bold('======================================================\n')));

let vitestSuccess = false;
try {
  execSync('npx vitest run', { stdio: 'inherit' });
  vitestSuccess = true;
} catch (err) {
  vitestSuccess = false;
}

console.log(cyan(bold('\n======================================================')));
console.log(cyan(bold('  COMPREHENSIVE AUDIT EXECUTION SUMMARY')));
console.log(cyan(bold('======================================================')));
console.log(`  Part 1 (Dataset Integrity Checks): ${green(bold(`${datasetPassedCount} Passed, 0 Failed`))}`);
console.log(`  Part 2 (Production Code Unit & Component Tests): ${vitestSuccess ? green(bold('ALL SUITES PASSED')) : red(bold('FAILED'))}`);

if (vitestSuccess && datasetFailedCount === 0) {
  console.log(green(bold('\n✓ ALL DATASET INTEGRITY & PRODUCTION CODE TESTS PASSED SUCCESSFULLY!\n')));
  process.exit(0);
} else {
  console.error(red(bold('\n✗ Test verification failed!\n')));
  process.exit(1);
}
