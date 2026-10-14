/**
 * In-browser 2× / 4× upscale via Real-ESRGAN General x4v3 (BSD-3-Clause).
 * ~5 MB model. 2× is implemented as 4× then high-quality downscale.
 */
import { getSession, ort } from './ort'

const MODEL_URL = 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx'
const TILE = 128
const PAD = 8

async function runTile(session: ort.InferenceSession, tile: ImageData): Promise<ImageData> {
  const { width: w, height: h, data } = tile
  const input = new Float32Array(1 * 3 * h * w)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, p = y * w + x
    input[p] = data[i] / 255
    input[h * w + p] = data[i + 1] / 255
    input[2 * h * w + p] = data[i + 2] / 255
  }
  const out = await session.run({ input: new ort.Tensor('float32', input, [1, 3, h, w]) })
  const t = out[session.outputNames[0]] as ort.Tensor
  const o = t.data as Float32Array
  const ow = w * 4, oh = h * 4
  const res = new ImageData(ow, oh)
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const p = y * ow + x, i = (y * ow + x) * 4
    res.data[i] = Math.min(255, Math.max(0, o[p] * 255))
    res.data[i + 1] = Math.min(255, Math.max(0, o[oh * ow + p] * 255))
    res.data[i + 2] = Math.min(255, Math.max(0, o[2 * oh * ow + p] * 255))
    res.data[i + 3] = 255
  }
  return res
}

function scaleMask(mask: ImageData, outW: number, outH: number): ImageData {
  const mc = document.createElement('canvas'); mc.width = mask.width; mc.height = mask.height
  mc.getContext('2d')!.putImageData(mask, 0, 0)
  const oc = document.createElement('canvas'); oc.width = outW; oc.height = outH
  const octx = oc.getContext('2d')!
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(mc, 0, 0, outW, outH)
  return octx.getImageData(0, 0, outW, outH)
}

export async function upscale(
  rgb: ImageData,
  mask: ImageData,
  scale: 2 | 4,
  onProgress?: (pct: number, label: string) => void,
): Promise<{ rgb: ImageData; mask: ImageData }> {
  onProgress?.(2, 'Loading Real-ESRGAN (~5 MB)…')
  const session = await getSession(MODEL_URL)
  onProgress?.(15, 'Upscaling…')

  const out4W = rgb.width * 4, out4H = rgb.height * 4
  const out4 = new ImageData(out4W, out4H)
  const tilesX = Math.ceil(rgb.width / TILE)
  const tilesY = Math.ceil(rgb.height / TILE)
  const total = tilesX * tilesY
  let done = 0

  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
    const x0 = tx * TILE, y0 = ty * TILE
    const x1 = Math.min(rgb.width, x0 + TILE), y1 = Math.min(rgb.height, y0 + TILE)
    const px0 = Math.max(0, x0 - PAD), py0 = Math.max(0, y0 - PAD)
    const px1 = Math.min(rgb.width, x1 + PAD), py1 = Math.min(rgb.height, y1 + PAD)
    const tw = px1 - px0, th = py1 - py0
    const tile = new ImageData(tw, th)
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const si = ((py0 + y) * rgb.width + (px0 + x)) * 4
      const di = (y * tw + x) * 4
      tile.data[di] = rgb.data[si]; tile.data[di + 1] = rgb.data[si + 1]
      tile.data[di + 2] = rgb.data[si + 2]; tile.data[di + 3] = 255
    }
    const up = await runTile(session, tile)
    const ox = (x0 - px0) * 4, oy = (y0 - py0) * 4
    const cw = (x1 - x0) * 4, ch = (y1 - y0) * 4
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = ((oy + y) * up.width + (ox + x)) * 4
      const di = ((y0 * 4 + y) * out4W + (x0 * 4 + x)) * 4
      out4.data[di] = up.data[si]
      out4.data[di + 1] = up.data[si + 1]
      out4.data[di + 2] = up.data[si + 2]
      out4.data[di + 3] = 255
    }
    done++
    onProgress?.(15 + Math.round((done / total) * 80), `Upscaling tile ${done}/${total}…`)
  }

  if (scale === 4) {
    onProgress?.(100, 'Done')
    return { rgb: out4, mask: scaleMask(mask, out4W, out4H) }
  }

  // 2×: downscale the 4× result
  const outW = rgb.width * 2, outH = rgb.height * 2
  const c = document.createElement('canvas'); c.width = out4W; c.height = out4H
  c.getContext('2d')!.putImageData(out4, 0, 0)
  const o = document.createElement('canvas'); o.width = outW; o.height = outH
  const ctx = o.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(c, 0, 0, outW, outH)
  onProgress?.(100, 'Done')
  return { rgb: ctx.getImageData(0, 0, outW, outH), mask: scaleMask(mask, outW, outH) }
}
