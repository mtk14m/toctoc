const LOCAL_NUMBER_LENGTH = 9 // Guinée : 9 chiffres (ex. 621 00 00 00)

/**
 * Ramène un numéro saisi à la main au format international (E.164).
 * Ce qu'on ne sait pas interpréter est renvoyé tel quel : `isValidPhone` le refusera ensuite.
 */
export function normalizePhone(raw: string, defaultCountryCode = '224'): string {
  const cleaned = raw.replace(/[^\d+]/g, '')

  if (cleaned.startsWith('+')) return cleaned
  // "00224..." → "+224..."
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  // "224621000000" : indicatif présent sans le +
  if (
    cleaned.startsWith(defaultCountryCode) &&
    cleaned.length === defaultCountryCode.length + LOCAL_NUMBER_LENGTH
  ) {
    return `+${cleaned}`
  }
  // "621000000" : numéro local
  if (cleaned.length === LOCAL_NUMBER_LENGTH) return `+${defaultCountryCode}${cleaned}`

  return cleaned
}

/** E.164 : « + », puis 7 à 15 chiffres, le premier n'étant pas 0. */
export function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}
