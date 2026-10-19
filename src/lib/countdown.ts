/** Whole seconds as a clock, `m:ss`: 42 reads "0:42" and 65 reads "1:05". Zero or less reads "0:00". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Seconds as the whole minutes still to wait, rounded up and never below one: 241 reads "5 min". */
export function formatMinutesLeft(seconds: number): string {
  return `${Math.max(1, Math.ceil(seconds / 60))} min`
}
