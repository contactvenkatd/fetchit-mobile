/** Recovery is deliberately bounded: attempt zero may recover; attempt one may not. */
export function canAttemptRecovery(attempts: number): boolean {
  return attempts === 0;
}
