import * as ort from 'onnxruntime-web'

let ready: Promise<void> | null = null

/** Configure ONNX Runtime WASM once (shared with @imgly/background-removal @ 1.21.0). */
export function ensureOrt(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      // GitHub Pages has no COOP/COEP → force single-thread every time.
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
      ort.env.wasm.simd = true
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/'
    })()
  }
  // Re-assert in case another library bumped numThreads
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
  return ready
}

export { ort }

const sessionCache = new Map<string, Promise<ort.InferenceSession>>()

export function getSession(url: string): Promise<ort.InferenceSession> {
  if (!sessionCache.has(url)) {
    sessionCache.set(url, (async () => {
      await ensureOrt()
      return ort.InferenceSession.create(url, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    })())
  }
  return sessionCache.get(url)!
}
