import { Question, PracticeSetMeta } from '../types/oir';
import setsSummaryData from './setsSummary.json';

// Dynamically import question sets on-demand so initial Dashboard load does not download all 20 sets
const questionLoaders = import.meta.glob<{ default: Question[] }>('./questions/*.json');

// In-memory cache of loaded questions
const loadedQuestionsCache = new Map<number, Question[]>();

export function getSetsSummary(): PracticeSetMeta[] {
  return setsSummaryData as PracticeSetMeta[];
}

export async function getQuestionsForSetAsync(setNumber: number): Promise<Question[]> {
  const cached = loadedQuestionsCache.get(setNumber);
  if (cached) return cached;

  const pad = setNumber.toString().padStart(2, '0');
  const path = `./questions/set${pad}.json`;
  const loader = questionLoaders[path];
  if (loader) {
    try {
      const mod = await loader();
      if (mod && mod.default) {
        loadedQuestionsCache.set(setNumber, mod.default);
        return mod.default;
      }
    } catch (err) {
      console.error(`Failed to load questions for set ${setNumber}:`, err);
    }
  }
  console.error(`Could not find questions for set ${setNumber} at path ${path}`);
  return [];
}

export function prefetchQuestionsForSet(setNumber: number): void {
  if (!loadedQuestionsCache.has(setNumber)) {
    getQuestionsForSetAsync(setNumber).catch(() => {});
  }
}

export function getQuestionsForSet(setNumber: number): Question[] {
  const cached = loadedQuestionsCache.get(setNumber);
  if (cached) return cached;
  return [];
}
