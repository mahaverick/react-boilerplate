/** Whole seconds as a clock, `m:ss`: 42 reads "0:42" and 65 reads "1:05". Zero or less reads "0:00". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Seconds as the time still to wait: whole seconds under a minute ("42 seconds",
 * "1 second"), then whole minutes rounded up ("5 min" for 241 s). Never below one second.
 */
export function formatTimeLeft(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds))
  if (whole < 60) return `${whole} ${whole === 1 ? 'second' : 'seconds'}`
  return `${Math.ceil(whole / 60)} min`
}
