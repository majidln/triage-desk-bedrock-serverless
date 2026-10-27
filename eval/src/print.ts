// Terminal output, rendered from already-computed results.

import type { RedTeamResult } from './score/redteam.ts';
import type { ReplyCheck } from './score/replies.ts';
import { COLUMNS, LEVELS } from './score/urgency.ts';
import type { Accuracy, LevelScore, Matrix } from './score/urgency.ts';
import type { Urgency } from './types.ts';

export function printMatrix(m: Matrix) {
    console.log(`  ${'expected \\ AI'.padEnd(14)}${COLUMNS.map((c) => c.padStart(9)).join('')}`);
    for (const level of LEVELS) {
        console.log(`  ${level.padEnd(14)}${COLUMNS.map((c) => String(m[level][c]).padStart(9)).join('')}`);
    }
}

export function printLevels(scores: Record<Urgency, LevelScore>) {
    // "n/a" when there is nothing to divide by: 0% would wrongly read as "always wrong".
    const pct = (x: number, whole: number) => (whole === 0 ? 'n/a' : `${(x * 100).toFixed(1)}%`).padStart(6);
    for (const level of LEVELS) {
        const s = scores[level];
        console.log(
            `  ${level.padEnd(10)} support ${String(s.support).padStart(2)}   ` +
                `recall ${pct(s.recall, s.support)}   precision ${pct(s.precision, s.predicted)}`,
        );
    }
}

export function printReplyChecks(checks: ReplyCheck[]) {
    const flagged = checks.filter((c) => c.missing.length > 0 || c.forbidden.length > 0);
    for (const c of flagged) {
        const parts = [];
        if (c.missing.length > 0) parts.push(`missing: ${c.missing.join(', ')}`);
        if (c.forbidden.length > 0) parts.push(`FORBIDDEN: ${c.forbidden.join(', ')}`);
        console.log(`  ${c.id.padEnd(5)}${parts.join(' | ')}`);
    }
    const withForbidden = checks.filter((c) => c.forbidden.length > 0).length;
    const withMissing = checks.filter((c) => c.missing.length > 0).length;
    console.log(
        `  ${checks.length} replies checked: ${withForbidden} with a forbidden phrase, ${withMissing} missing something`,
    );
}

export function printAccuracyBy(scores: Record<string, Accuracy>) {
    for (const [name, a] of Object.entries(scores)) {
        const pct = a.processed === 0 ? 'n/a' : `${(a.model * 100).toFixed(1)}%`;
        console.log(`  ${name.padEnd(16)} ${pct.padStart(6)} (${a.correct}/${a.processed})`);
    }
}

export function printRedTeam(results: RedTeamResult[]) {
    for (const r of results) {
        const why = r.reasons.length > 0 ? `  (${r.reasons.join('; ')})` : '';
        console.log(`  ${r.id.padEnd(5)}${r.attack.padEnd(18)}${r.verdict}${why}`);
    }
    const fails = results.filter((r) => r.verdict === 'FAIL').length;
    console.log(`  ${fails}/${results.length} failed automatically; review the rest by hand`);
}
