# OIR PREPARATION HUB

> **"Practice Smart. Think Fast. Prepare to Lead."**

An interactive, high-fidelity web platform designed exclusively for **Services Selection Board (SSB) Officer Intelligence Rating (OIR)** test preparation.

The platform provides a simulated exam environment containing all **20 Practice Sets** (50 questions per set = **1,000 verified questions**) directly extracted and calibrated from authoritative SSB OIR preparation material, complete with high-resolution original diagrams, strict independent timers, automated grading, step-by-step solutions, and persistent progress analytics.

---

## 🌟 Main Features

### 1. Complete Curriculum & Faithful Content (1,000 Questions)
- **All 20 Practice Sets**: 50 questions in every set, strictly matching the SSB OIR examination syllabus.
- **Original High-Resolution Diagrams**: 792 question figures and 60 step-by-step solution calculation tables extracted and verified across all 20 sets (cubes, dice, figure series, patterns, Class A/B groups, and arithmetic diagrams).
- **Comprehensive Question Type Support**:
  - **Single-choice questions**: Verbal & non-verbal reasoning.
  - **Multiple-choice figure questions**: Class A/B selection (e.g., *"Which two figures belong to Class A?"*).
  - **Two-part letter-series questions (Question 13)**: Letter pair series with robust whitespace and case-insensitive normalization.
  - **Two-part numerical-series questions (Question 45)**: Number pair series with fractional and decimal support.
  - **Three-part dropdown sentence completions (Question 18)**: Multi-dropdown controls storing option IDs and validating full sentence structure.
  - **Numerical arithmetic questions (Questions 20 & 23)**: Subtraction and addition problems with verified single missing digits.
  - **Boolean questions**: Cube similarity and visual reasoning (*"Yes"* / *"No"*).
  - **Text / anagram questions**: Letter and word responses with strict anti-partial matching.
- **Source Fidelity & Discrepancy Transparency**: Set 06 Question 11 includes an explicit source discrepancy banner documenting the mismatch in original test booklet material without penalizing candidate preparation.

### 2. Dual Independent Timers & Anti-Cheat Persistence
- **Per-Question Countdown Timer**: Configurable (default **40 seconds**). Persists remaining time during backward and forward navigation; expired questions remain permanently locked.
- **Overall Test Countdown Timer**: Configurable (default **25 minutes**). Automatically evaluates saved answers upon timeout without deleting attempts.
- **Timestamp-Based Storage**: Timers use absolute timestamps (`Date.now()`) stored in browser `localStorage`, ensuring page reloads or browser restarts do not reset or inflate remaining time.
- **Duplicate Submission Guards**: `sessionStorage` guard flags prevent double-scoring or redundant state mutations.

### 3. Dedicated Timer Settings Section
- Modal dialog allowing customization of both the per-question timer (in seconds) and the total exam duration (in minutes).
- "Reset to Default" button instantly restores standard 40s / 25m SSB testing conditions.

### 4. Interactive Examination Interface
- Distraction-free single-question focus mode.
- Interactive click-to-zoom modal for intricate geometric and dice diagrams.
- Interactive question navigation palette (Answered, Current, Skipped/Expired, Not Visited).
- Clear confirmation dialog before manual test submission.

### 5. Detailed Results & Official OIR Rating Presentation
- **Official SSB OIR Rating Scale** (Reference: Booklet Page 7):
  - **OIR - 1**: Outstanding
  - **OIR - 2**: Excellent
  - **OIR - 3**: Above Average
  - **OIR - 4**: Average
  - **OIR - 5**: Below Average
- **Unofficial Practice Benchmark**: Clearly identifies simulated percentage performance bands with explicit guidance on SSB's relative grading doctrine.
- **Scoring Breakdown**: Total score, accuracy percentage, correct answers (+1 mark), incorrect answers (0 negative marking, strictly adhering to SSB rules), unanswered count, total time consumed, and average pace per question.

### 6. Solutions & Step-by-Step Explanations
- Color-coded question cards (🟢 Correct, 🔴 Incorrect, 🟠 Unanswered).
- Filterable by All, Correct, Incorrect, and Unanswered.
- Side-by-side user answer vs. official correct answer comparison.
- Full dropdown sentence reconstruction and solution calculation diagrams.

### 7. Persistent Progress & Unlimited Retakes
- Set completion status saved permanently in `localStorage`.
- Dashboard metrics update dynamically: Completed Sets, Total Attempts, Questions Practiced (actual answered questions), Overall Accuracy, and Best Score.
- Unlimited retakes supported for all sets.

---

## 🛠️ Technology Stack

- **Frontend Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite 6](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Persistence**: Browser `localStorage` and `sessionStorage`

---

## 📁 Project Structure

```
OIR_PRACTICE/
├── public/
│   └── images/
│       ├── set01/ ... set20/       # 792 question figures and 60 solution calculation diagrams
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx           # Practice sets grid and live statistics
│   │   ├── ExamInterface.tsx       # Timed exam screen with persistent countdowns
│   │   ├── Navbar.tsx              # Top navigation bar and global quick actions
│   │   ├── ResultsPage.tsx         # Scorecard with official OIR 1-5 definitions
│   │   ├── SettingsModal.tsx       # Timer duration configuration modal
│   │   ├── SolutionsPage.tsx       # Comprehensive solution review and diagrams
│   │   └── TestStartModal.tsx      # Pre-test briefing and instructions
│   ├── data/
│   │   ├── questions/
│   │   │   ├── set01.json ... set20.json  # 20 practice sets (50 questions each = 1,000 total)
│   │   ├── oirLoader.ts            # Dynamic dataset loader and indexer
│   │   └── setsSummary.json        # Metadata manifest for all 20 practice sets
│   ├── types/
│   │   └── oir.ts                  # Comprehensive TypeScript type definitions
│   ├── utils/
│   │   ├── evaluator.ts            # Strict answer normalization and grading engine
│   │   └── storage.ts              # LocalStorage persistence, stats aggregation, and timeout recovery
│   ├── App.tsx                     # Main application controller and view router
│   ├── index.css                   # Global styles and Tailwind utility imports
│   ├── main.tsx                    # React application entry point
│   └── vite-env.d.ts               # Vite client types declaration
├── tests/
│   └── automated_verification.js   # 91-check automated verification suite
├── .gitignore                      # Git exclusion rules
├── package.json                    # Project dependencies and npm scripts
├── tsconfig.json                   # TypeScript configuration
└── vite.config.ts                  # Vite build and plugin configuration
```

---

## 🚀 Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- [npm](https://www.npmjs.com/) (bundled with Node.js)

### 1. Installation
Clone the repository and install the dependencies:
```bash
git clone <repository-url>
cd OIR_PRACTICE
npm install
```

### 2. Development Server
Start the local development server:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

### 3. Production Build
Compile TypeScript and bundle the application for production:
```bash
npm run build
```
The optimized static build will be generated in the `dist/` directory.

### 4. Preview Production Build
Preview the production build locally:
```bash
npm run preview
```
Open `http://localhost:4173`.

---

## ⏱️ Practice Test Instructions & Timer Rules

1. **Test Start**: Select any practice set from the dashboard and click **Start Practice Set** on the briefing card.
2. **Pacing**: You have 40 seconds per question by default. Answer or skip before the timer reaches 0.
3. **Navigation**: Use the question palette or the Previous/Next buttons. Returning to a previous question restores its exact remaining time.
4. **Answer Submission**:
   - For single-choice questions, select the matching option.
   - For letter/number series, enter both parts in the text fields provided.
   - For dropdown sentence completions, select the correct word for each of the three positions.
   - For arithmetic boxed digits, input the single missing digit.
5. **Auto-Submit on Timeout**: If the 25-minute test timer expires, all answered questions are automatically submitted and graded.

---

## 🧪 Automated Testing & Verification

The project includes an end-to-end automated test suite verifying evaluation logic, edge cases, timer persistence simulations, and data integrity:

```bash
node tests/automated_verification.js
```

### Verification Coverage:
- **Suite 1: Question Types & Normalization**: Two-part letter series, two-part number series, multi-dropdown sentence completions, arithmetic missing digits, Class A figure sets, text questions (strict anti-partial match), and boolean responses.
- **Suite 2: Timer State & Persistence**: Decrement accuracy, backward navigation remaining time retention, and expired question locking.
- **Suite 3: Overall Timeout & Submission Guards**: Timestamp-based timeout identification and duplicate submission prevention.
- **Suite 4: Dataset Integrity Audit**: Verifies that all 20 JSON datasets exist, contain exactly 50 questions each (1,000 total), have zero broken image references, and correctly flag known source discrepancies.

---

## 📄 License
This project is open-source and intended for educational and SSB examination preparation purposes.
