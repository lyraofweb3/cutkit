/** Optional Colab GPU backend (colab/CutKit_GPU.ipynb). URL + token live only in localStorage. */
const URL_KEY = 'cutkit.colabUrl'
const TOKEN_KEY = 'cutkit.colabToken'

export const COLAB_NOTEBOOK = 'https://colab.research.google.com/github/lyraofweb3/cutkit/blob/main/colab/CutKit_GPU.ipynb'
export const getColab = () => ({ url: (localStorage.getItem(URL_KEY) ?? '').replace(/\/+$/, ''), token: localStorage.getItem(TOKEN_KEY) ?? '' })
export function setColab(url: string, token: string) {
  url.trim() ? localStorage.setItem(URL_KEY, url.trim().replace(/\/+$/, '')) : localStorage.removeItem(URL_KEY)
  token.trim() ? localStorage.setItem(TOKEN_KEY, token.trim()) : localStorage.removeItem(TOKEN_KEY)
  window.dispatchEvent(new Event('cutkit-colab'))
}

export type ColabStatus = { state: 'unset' | 'checking' | 'online' | 'offline'; gpu?: string | null; error?: string }

export async function checkColab(timeoutMs = 6000): Promise<ColabStatus> {
  const { url, token } = getColab()
  if (!url || !token) return { state: 'unset' }
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return { state: 'offline', error: `HTTP ${r.status}` }
    const j = await r.json()
    return j.ok ? { state: 'online', gpu: j.gpu } : { state: 'offline', error: 'bad health response' }
  } catch (e) {
    return { state: 'offline', error: (e as Error).message }
  }
}

export class ColabOffline extends Error {
  constructor(msg = 'Colab GPU is offline. Start the CutKit Colab notebook and paste its URL + token in Settings.') { super(msg) }
}

export async function colabPost(path: string, form: FormData, signal?: AbortSignal): Promise<Blob> {
  const { url, token } = getColab()
  if (!url || !token) throw new ColabOffline('Connect a Colab GPU in Settings first.')
  let r: Response
  try {
    r = await fetch(`${url}${path}`, { method: 'POST', body: form, headers: { 'X-CutKit-Token': token }, signal })
  } catch {
    throw new ColabOffline()
  }
  if (r.status === 401) throw new Error('Colab rejected the token. Copy the token printed by the notebook into Settings.')
  if (!r.ok) {
    let msg = `Colab error ${r.status}`
    try { const j = await r.json(); if (j.detail) msg = String(j.detail) } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.blob()
}
