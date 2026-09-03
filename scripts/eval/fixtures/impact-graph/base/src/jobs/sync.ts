import { retryRequest } from '../api/client'
export async function sync(job) {
  const r = await retryRequest(job)
  if (r === null) return
}
