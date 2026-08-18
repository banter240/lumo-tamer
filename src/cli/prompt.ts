import type { Interface as ReadlineInterface } from 'readline';

/**
 * One prompt function for the life of a readline interface.
 * Must register `close` once: adding it inside every question leaks listeners
 * and trips MaxListenersExceededWarning after ~10 turns (#64).
 */
export function createLinePrompt(
    rl: ReadlineInterface,
    label = 'You: ',
): () => Promise<string | null> {
    let closed = false;
    rl.once('close', () => {
        closed = true;
    });

    return () =>
        new Promise((resolve) => {
            if (closed) {
                resolve(null);
                return;
            }
            rl.question(label, (answer) => {
                resolve(closed ? null : answer);
            });
        });
}
