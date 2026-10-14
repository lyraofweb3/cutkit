import type { Bg, Doc, Shadow, SizePreset } from './types'
import { composeRGBA, imageDataToCanvas, loadImage } from './image'

const imgCache = new Map<string, Promise<HTMLImageElement>>()
function cachedImage(src: string) {
  if (!imgCache.has(src)) imgCache.set(src, loadImage(src))
  return imgCache.get(src)!
}

export function trimBox(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 10) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: c.width, h: c.height }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function cover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number) {
  const s = Math.max(W / sw, H / sh)
  const dw = sw * s, dh = sh * s
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

async function paintBg(ctx: CanvasRenderingContext2D, W: number, H: number, bg: Bg, doc: Doc) {
  if (bg.kind === 'solid') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H) }
  else if (bg.kind === 'gradient') {
    const a = (bg.angle * Math.PI) / 180
    const r = Math.abs(W * Math.sin(a)) / 2 + Math.abs(H * Math.cos(a)) / 2
    const g = ctx.createLinearGradient(W / 2 - Math.sin(a) * r, H / 2 + Math.cos(a) * r, W / 2 + Math.sin(a) * r, H / 2 - Math.cos(a) * r)
    g.addColorStop(0, bg.from); g.addColorStop(1, bg.to)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else if (bg.kind === 'image') {
    const img = await cachedImage(bg.src)
    ctx.save()
    if (bg.blur) ctx.filter = `blur(${(bg.blur * Math.max(W, H)) / 1000}px)`
    cover(ctx, img, img.naturalWidth, img.naturalHeight, W, H)
    ctx.restore()
  } else if (bg.kind === 'blur') {
    const src = imageDataToCanvas(doc.rgb)
    ctx.save()
    ctx.filter = `blur(${(bg.amount * Math.max(W, H)) / 1000}px)`
    cover(ctx, src, src.width, src.height, W, H)
    ctx.restore()
  }
}

export type RenderOpts = { bg: Bg; shadow: Shadow; size: SizePreset; jpg?: boolean }

/** Render final composition to a canvas */
export async function render(doc: Doc, o: RenderOpts): Promise<HTMLCanvasElement> {
  const fg = imageDataToCanvas(composeRGBA(doc.rgb, doc.mask))
  let W = doc.width, H = doc.height
  if (o.size === 'square') { W = 1080; H = 1080 }
  else if (o.size === 'story') { W = 1080; H = 1920 }
  else if (o.size === 'amazon') { W = 2000; H = 2000 }

  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  const bg: Bg = o.jpg && o.bg.kind === 'transparent' ? { kind: 'solid', color: '#ffffff' } : o.bg
  await paintBg(ctx, W, H, bg, doc)

  let sx = 0, sy = 0, sw = fg.width, sh = fg.height, dx = 0, dy = 0, dw = W, dh = H
  if (o.size !== 'original') {
    const box = o.size === 'amazon' ? trimBox(fg) : { x: 0, y: 0, w: fg.width, h: fg.height }
    const pad = o.size === 'amazon' ? 0.85 : 0.92
    const s = Math.min((W * pad) / box.w, (H * pad) / box.h)
    sx = box.x; sy = box.y; sw = box.w; sh = box.h
    dw = box.w * s; dh = box.h * s; dx = (W - dw) / 2; dy = (H - dh) / 2
  }

  if (o.shadow.enabled) {
    const k = Math.max(W, H) / 1000
    ctx.save()
    ctx.shadowColor = hexA(o.shadow.color, o.shadow.opacity)
    ctx.shadowBlur = o.shadow.blur * k
    ctx.shadowOffsetX = o.shadow.offsetX * k
    ctx.shadowOffsetY = o.shadow.offsetY * k
    ctx.drawImage(fg, sx, sy, sw, sh, dx, dy, dw, dh)
    ctx.restore()
  }
  ctx.drawImage(fg, sx, sy, sw, sh, dx, dy, dw, dh)
  return c
}

export function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export async function renderBlob(doc: Doc, o: RenderOpts, fmt: 'png' | 'jpg'): Promise<Blob> {
  const c = await render(doc, { ...o, jpg: fmt === 'jpg' })
  return new Promise((res) => c.toBlob((b) => res(b!), fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92))
}

export { cachedImage }
