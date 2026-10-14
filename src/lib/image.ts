export function createImageData(w: number, h: number, fill = 255): ImageData {
  const d = new ImageData(w, h)
  if (fill !== 0) d.data.fill(fill)
  return d
}

export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.crossOrigin = 'anonymous'
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src)
  })
}

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const img = await loadImage(blob)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height)
}

export function imageDataToCanvas(id: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = id.width
  c.height = id.height
  c.getContext('2d')!.putImageData(id, 0, 0)
  return c
}

export function imageDataToBlob(id: ImageData, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res) => imageDataToCanvas(id).toBlob((b) => res(b!), type, quality))
}

export async function imageDataToDataUrl(id: ImageData, type = 'image/png'): Promise<string> {
  const blob = await imageDataToBlob(id, type)
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.readAsDataURL(blob)
  })
}

/** Combine RGB + alpha mask into RGBA ImageData */
export function composeRGBA(rgb: ImageData, mask: ImageData): ImageData {
  const out = new ImageData(rgb.width, rgb.height)
  const a = out.data, r = rgb.data, m = mask.data
  for (let i = 0; i < r.length; i += 4) {
    a[i] = r[i]; a[i + 1] = r[i + 1]; a[i + 2] = r[i + 2]
    a[i + 3] = m[i] // mask stored in R channel (or all)
  }
  return out
}

/** Extract alpha as grayscale ImageData (R=G=B=A=alpha) */
export function extractAlpha(rgba: ImageData): ImageData {
  const m = new ImageData(rgba.width, rgba.height)
  for (let i = 0; i < rgba.data.length; i += 4) {
    const a = rgba.data[i + 3]
    m.data[i] = m.data[i + 1] = m.data[i + 2] = a
    m.data[i + 3] = 255
  }
  return m
}

export function stripAlpha(rgba: ImageData): ImageData {
  const rgb = cloneImageData(rgba)
  for (let i = 3; i < rgb.data.length; i += 4) rgb.data[i] = 255
  return rgb
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const baseName = (n: string) => n.replace(/\.[^.]+$/, '')
