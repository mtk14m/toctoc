/** « 09:00 » → « 9h », « 11:30 » → « 11h30 », « 24:00 » → « minuit ». */
export function formatClockFr(clock: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock)
  if (!match) return clock

  const hours = Number(match[1])
  const minutes = match[2]!
  if (minutes === '00' && (hours === 24 || hours === 0)) return 'minuit'
  return minutes === '00' ? `${hours}h` : `${hours}h${minutes}`
}
