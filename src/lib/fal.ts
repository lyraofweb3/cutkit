/**
 * Minimal fal.ai client (queue API) for a static site.
 * The key is stored only in the user's localStorage and sent directly to fal.ai.
 */
const KEY = 'cutkit.falKey'

export const getFalKey = () => localStorage.getItem(KEY) ?? ''
export const setFalKey = (k: string) => (k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY))

export class FalKeyMissing extends Error {
  constructor() { super('Add your fal.ai API key in Settings to use AI tools.') }
}

export const FAL_MODELS = {
  productShot: 'fal-ai/bria/product-shot',
  generate: 'fal-ai/flux/schnell',
  edit: 'fal-ai/flux-pro/kontext',
  expand: 'fal-ai/bria/expand',
  tryon: 'fal-ai/flux-pro/v1/vto',
} as const

type QueueStatus = { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'; queue_position?: number; response_url?: string; status_url?: string }

async function falFetch(url: string, key: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); msg = j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : j.message ?? msg } catch { /* ignore */ }
    if (res.status === 401 || res.status === 403) msg = 'fal.ai rejected the key (401/403). Check the key in Settings.'
    throw new Error(msg)
  }
  return res.json()
}

export async function falRun<T = unknown>(
  model: string,
  input: Record<string, unknown>,
  onStatus?: (label: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  const key = getFalKey()
  if (!key) throw new FalKeyMissing()
  onStatus?.('Submitting to fal.ai…')
  const sub = await falFetch(`https://queue.fal.run/${model}`, key, { method: 'POST', body: JSON.stringify(input), signal }) as { request_id: string; status_url: string; response_url: string }
  const statusUrl = sub.status_url ?? `https://queue.fal.run/${model}/requests/${sub.request_id}/status`
  const responseUrl = sub.response_url ?? `https://queue.fal.run/${model}/requests/${sub.request_id}`
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled')
    await new Promise((r) => setTimeout(r, 1200))
    const s = await falFetch(statusUrl, key, { signal }) as QueueStatus
    if (s.status === 'COMPLETED') break
    onStatus?.(s.status === 'IN_QUEUE' ? `Queued${s.queue_position != null ? ` (#${s.queue_position})` : ''}…` : `Generating… ${Math.round((Date.now() - started) / 1000)}s`)
    if (Date.now() - started > 5 * 60_000) throw new Error('fal.ai timed out after 5 minutes')
  }
  return falFetch(responseUrl, key, { signal }) as Promise<T>
}

/** Extract first image URL from typical fal output shapes */
export function firstImageUrl(out: unknown): string {
  const o = out as { images?: { url: string }[]; image?: { url: string }; data?: { images?: { url: string }[] } }
  const url = o.images?.[0]?.url ?? o.image?.url ?? o.data?.images?.[0]?.url
  if (!url) throw new Error('fal.ai returned no image')
  return url
}

export async function urlToBlob(url: string): Promise<Blob> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not download result (${r.status})`)
  return r.blob()
}
