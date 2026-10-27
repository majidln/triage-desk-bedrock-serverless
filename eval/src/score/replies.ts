// Part 3b: reply checks against must_include / must_not.

import type { Collected } from '../types.ts';

// Reply checks are flags for the manual review, not a score: a substring search
// is fooled by negation ("we will not refund") and by paraphrase ("two weeks").
export interface ReplyCheck {
    id: string; // ticket id
    missing: string[]; // must_include items not found
    forbidden: string[]; // must_not items found
}

// Make the search fair: same case, dashes, quotes and spacing on both sides.
export function normalize(text: string): string {
    return text.toLowerCase().replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export function checkReplies(collected: Collected[]): ReplyCheck[] {
    return collected
        .filter((c) => c.outcome === 'processed' && c.response)
        .map((c) => {
            const reply = normalize(c.response!);
            const ticket = c.submission.ticket;
            return {
                id: ticket.id,
                missing: ticket.must_include.filter((p) => !reply.includes(normalize(p))),
                forbidden: ticket.must_not.filter((p) => reply.includes(normalize(p))),
            };
        });
}
