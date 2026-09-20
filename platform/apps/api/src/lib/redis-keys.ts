/** Toutes les clés Redis, nommées au même endroit pour éviter les collisions et les fautes de frappe. */
export const redisKeys = {
  otpRequests: (phone: string) => `otp:requests:${phone}`,
  groupOrderCreations: (userId: string) => `group-order:creations:${userId}`,
  groupOrderCreationsByIp: (ip: string) => `group-order:creations:ip:${ip}`,
  ratingsByIp: (ip: string) => `rating:ip:${ip}`,
  joinsByPhone: (phone: string) => `join:phone:${phone}`,
  joinsByIp: (ip: string) => `join:ip:${ip}`,
} as const
