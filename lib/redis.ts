import { Redis } from '@upstash/redis';

let client: Redis | null = null;

// Lazy so importing this module never needs UPSTASH_REDIS_REST_URL/TOKEN (tests, build).
export function redis(): Redis {
  return (client ??= Redis.fromEnv());
}
