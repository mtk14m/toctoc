/** Toutes les clés Redis, nommées au même endroit pour éviter les collisions et les fautes de frappe. */
export const redisKeys = {
  otpRequests: (phone: string) => `otp:requests:${phone}`,
} as const
