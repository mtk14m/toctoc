import { Redis } from 'ioredis'
import { loadConfig } from './config.js'

export const redis = new Redis(loadConfig().redisUrl, {
  maxRetriesPerRequest: null, // requis par BullMQ
  lazyConnect: true,
})

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err)
})
