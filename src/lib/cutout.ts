import { removeBackground, type Config } from '@imgly/background-removal'
import { blobToImageData, extractAlpha, stripAlpha } from './image'
import type { Doc } from './types'
import { ensureOrt } from './ort'

export async function removeBg(
  file: Blob,
  onProgress?: (pct: number, label: string) => void,
): Promise<{ rgb: ImageData; mask: ImageData; width: number; height: number }> {
  await ensureOrt()
  const config: Config = {
    // Prefer our pinned ORT WASM; imgly still fetches its own model weights from CDN.
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      const label = key.startsWith('fetch') ? 'Downloading cutout model…' : 'Removing background…'
      onProgress?.(total ? Math.round((current / total) * 100) : 0, label)
    },
  }
  const cut = await removeBackground(file, config)
  const rgba = await blobToImageData(cut)
  return { rgb: stripAlpha(rgba), mask: extractAlpha(rgba), width: rgba.width, height: rgba.height }
}

export async function docFromFile(file: File): Promise<Doc> {
  const rgba = await blobToImageData(file)
  const mask = new ImageData(rgba.width, rgba.height)
  mask.data.fill(255)
  return {
    id: crypto.randomUUID(),
    name: file.name,
    original: rgba,
    width: rgba.width,
    height: rgba.height,
    rgb: stripAlpha(rgba),
    mask,
  }
}
