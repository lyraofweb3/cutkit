import { removeBackground, type Config } from '@imgly/background-removal'

export type Bg = { kind: 'transparent' } | { kind: 'solid'; color: string } | { kind: 'gradient'; from: string; to: string; angle: number }
export type SizePreset = 'original' | 'square' | 'story' | 'amazon'
export const SIZE_LABELS: Record<SizePreset, string> = {
  original: 'Original', square: 'Square 1080×1080', story: 'Story 1080×1920', amazon: 'Amazon 2000×2000',
}

export async function cutout(file: Blob, onProgress?: (pct: number, label: string) => void): Promise<Blob> {
  const config: Config = {
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      const label = key.startsWith('fetch') ? 'Downloading AI model (first run only)…' : 'Removing background…'
      onProgress?.(total ? Math.round((current / total) * 100) : 0, label)
    },
  }
  return removeBackground(file, config)
}

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src)
  })
}

function paintBg(ctx: CanvasRenderingContext2D, w: number, h: number, bg: Bg) {
  if (bg.kind === 'solid') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, w, h) }
  if (bg.kind === 'gradient') {
    const a = (bg.angle * Math.PI) / 180
    const cx = w / 2, cy = h / 2, r = Math.abs(w * Math.sin(a)) / 2 + Math.abs(h * Math.cos(a)) / 2
    const g = ctx.createLinearGradient(cx - Math.sin(a) * r, cy + Math.cos(a) * r, cx + Math.sin(a) * r, cy - Math.cos(a) * r)
    g.addColorStop(0, bg.from); g.addColorStop(1, bg.to)
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  }
}

/** Bounding box of non-transparent pixels */
function trimBox(img: HTMLImageElement) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const x = c.getContext('2d')!; x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1
  for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width; i++) {
    if (d[(y * c.width + i) * 4 + 3] > 10) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  if (maxX < 0) return { x: 0, y: 0, w: c.width, h: c.height }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export async function compose(cut: Blob, bg: Bg, size: SizePreset, format: 'png' | 'jpg'): Promise<Blob> {
  const img = await loadImage(cut)
  let W = img.naturalWidth, H = img.naturalHeight
  if (size === 'square') { W = 1080; H = 1080 } else if (size === 'story') { W = 1080; H = 1920 } else if (size === 'amazon') { W = 2000; H = 2000 }
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const effBg: Bg = format === 'jpg' && bg.kind === 'transparent' ? { kind: 'solid', color: '#ffffff' } : bg
  paintBg(ctx, W, H, effBg)
  if (size === 'original') ctx.drawImage(img, 0, 0)
  else {
    const box = size === 'amazon' ? trimBox(img) : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    const pad = size === 'amazon' ? 0.85 : 0.92 // Amazon: product fills ~85%
    const s = Math.min((W * pad) / box.w, (H * pad) / box.h)
    const dw = box.w * s, dh = box.h * s
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, box.x, box.y, box.w, box.h, (W - dw) / 2, (H - dh) / 2, dw, dh)
  }
  return new Promise((res) => c.toBlob((b) => res(b!), format === 'png' ? 'image/png' : 'image/jpeg', 0.92))
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
export const baseName = (n: string) => n.replace(/\.[^.]+$/, '')
