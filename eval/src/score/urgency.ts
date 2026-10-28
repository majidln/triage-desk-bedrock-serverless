// Part 3a: urgency. Accuracy, the confusion matrix, recall and precision per level.

import type { Collected, Urgency } from '../types.ts';
import { ratio } from '../util.ts';

export interface Accuracy {
  correct: number; // processed tickets with the right urgency
  processed: number; // tickets the AI actually answered
  total: number; // all tickets
  model: number; // correct / processed (0-1): how good is the AI's judgment?
  system: number; // correct / total (0-1): how often did a customer get the right urgency?
}

export function scoreAccuracy(collected: Collected[]): Accuracy {
  const processed = collected.filter((c) => c.outcome === 'processed');
  // Only processed tickets can be correct: a fallback's MEDIUM is luck, not judgment.
  const correct = processed.filter((c) => c.urgency === c.submission.ticket.expected_urgency);
  return {
    correct: correct.length,
    processed: processed.length,
    total: collected.length,
    model: ratio(correct.length, processed.length),
    system: ratio(correct.length, collected.length),
  };
}

export const LEVELS: Urgency[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
// OTHER: the model answered with something that isn't a level (v0 doesn't validate, gap G6).
// NONE: the model never answered (fallback, timeout, not submitted).
export const COLUMNS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'OTHER', 'NONE'] as const;
export type Column = (typeof COLUMNS)[number];

// matrix[expected][column] = number of tickets
export type Matrix = Record<Urgency, Record<Column, number>>;

export function confusionMatrix(collected: Collected[]): Matrix {
  const matrix = {} as Matrix;
  for (const level of LEVELS) {
    matrix[level] = {} as Record<Column, number>;
    for (const column of COLUMNS) matrix[level][column] = 0;
  }

  for (const c of collected) {
    const row = c.submission.ticket.expected_urgency;
    let column: Column;
    if (c.outcome !== 'processed') column = 'NONE';
    else if (LEVELS.includes(c.urgency as Urgency)) column = c.urgency as Column;
    else column = 'OTHER';
    matrix[row][column]++;
  }
  return matrix;
}

export interface LevelScore {
  support: number; // tickets that really are this level (the row total)
  predicted: number; // tickets the AI labeled this level (the column total)
  recall: number; // 0-1: of the real ones, how many were caught?
  precision: number; // 0-1: when the AI said this level, how often was it right?
}

export function scoreLevels(m: Matrix): Record<Urgency, LevelScore> {
  const scores = {} as Record<Urgency, LevelScore>;
  for (const level of LEVELS) {
    const hit = m[level][level];
    // The row includes OTHER and NONE: a ticket the AI never labeled was not caught.
    const row = COLUMNS.reduce((sum, c) => sum + m[level][c], 0);
    // The column only has the four real rows: what the AI said this level for.
    const column = LEVELS.reduce((sum, r) => sum + m[r][level], 0);
    scores[level] = { support: row, predicted: column, recall: ratio(hit, row), precision: ratio(hit, column) };
  }
  return scores;
}

export function accuracyBy(groups: Map<string, Collected[]>): Record<string, Accuracy> {
  const result: Record<string, Accuracy> = {};
  for (const [name, group] of groups) result[name] = scoreAccuracy(group);
  return result;
}
