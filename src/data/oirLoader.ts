import { Question, PracticeSetMeta } from '../types/oir';
import setsSummaryData from './setsSummary.json';

// Eager load all question sets so they are immediately available offline and fast
const questionModules = import.meta.glob<{ default: Question[] }>('./questions/*.json', {
  eager: true,
});

export function getSetsSummary(): PracticeSetMeta[] {
  return setsSummaryData as PracticeSetMeta[];
}

export function getQuestionsForSet(setNumber: number): Question[] {
  const pad = setNumber.toString().padStart(2, '0');
  const path = `./questions/set${pad}.json`;
  const mod = questionModules[path];
  if (mod && mod.default) {
    return mod.default;
  }
  console.error(`Could not find questions for set ${setNumber} at path ${path}`);
  return [];
}
