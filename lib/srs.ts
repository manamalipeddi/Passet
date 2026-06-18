// Lightweight SM-2-style spaced repetition scheduler.
export type SrsState = {
  ease_factor: number;
  interval_days: number;
};

export function updateSrs(state: SrsState, correct: boolean): SrsState & { next_review_date: string } {
  let { ease_factor, interval_days } = state;

  if (correct) {
    interval_days = interval_days <= 0 ? 1 : Math.round(interval_days * ease_factor);
    ease_factor = Math.min(ease_factor + 0.1, 3.0);
  } else {
    interval_days = 0;
    ease_factor = Math.max(ease_factor - 0.3, 1.3);
  }

  const next = new Date();
  next.setDate(next.getDate() + Math.max(interval_days, 1) - (interval_days === 0 ? 1 : 0));
  // wrong answers come back today/tomorrow rather than waiting a full interval
  if (!correct) next.setDate(new Date().getDate());

  return {
    ease_factor,
    interval_days,
    next_review_date: next.toISOString().slice(0, 10),
  };
}
