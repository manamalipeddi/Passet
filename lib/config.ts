// Single-user personal app — no auth system needed, just a name to greet you with.
export const USER_NAME = 'Manasa';

// Grammar pacing: introduce one new grammar point per this many vocab "learn"
// lessons. Grammar needs time to settle, so new structures come slowly while
// vocabulary keeps flowing. Bump this number to slow grammar further.
export const GRAMMAR_INTERVAL = 5;

// "Ready for new material" nudge: when a practice session ends, if at least
// `minAttempts` recent answers are on record and at least `accuracy` of them
// were correct, the finish screen suggests learning something new. Raise the
// bar (e.g. accuracy 0.95) to be pushed less often.
export const READY_FOR_NEW = {
  minAttempts: 20,
  accuracy: 0.9,
};
