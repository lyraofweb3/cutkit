/**
 * Magic Eraser via LaMa (Apache-2.0) ONNX from HuggingFace Carve/LaMa-ONNX.
 * Fixed 512×512 input; we resize the crop around the painted mask, inpaint, paste back.
 */
import { getSession, ort } from './ort'
import { cloneImageData } from './image'

const LAMA_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
const SIZE = 512

export async function magicErase(
  rgb: ImageData,
  eraseMask: ImageData, // white = erase (R channel)
  onProgress?: (pct: number, label: string) => void,
): Promise<ImageData> {
  let paintedPx = 0
  for (let i = 0; i < eraseMask.data.length; i += 4) if (eraseMask.data[i] > 20) paintedPx++
  if (!paintedPx) throw new Error('Magic eraser mask is empty')
  onProgress?.(5, `Loading LaMa (~200 MB)… ${paintedPx} px selected`)
  const session = await getSession(LAMA_URL)
  onProgress?.(25, 'Preparing…')

  // Bounding box of erase region with padding
  let minX = rgb.width, minY = rgb.height, maxX = -1, maxY = -1
  for (let y = 0; y < rgb.height; y++) for (let x = 0; x < rgb.width; x++) {
    if (eraseMask.data[(y * rgb.width + x) * 4] > 20) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return cloneImageData(rgb)

  const pad = 40
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(rgb.width - 1, maxX + pad); maxY = Math.min(rgb.height - 1, maxY + pad)
  const bw = maxX - minX + 1, bh = maxY - minY + 1
  const side = Math.max(bw, bh)
  const cx = minX + bw / 2, cy = minY + bh / 2
  let x0 = Math.round(cx - side / 2), y0 = Math.round(cy - side / 2)
  x0 = Math.max(0, Math.min(rgb.width - side, x0))
  y0 = Math.max(0, Math.min(rgb.height - side, y0))
  const sw = Math.min(side, rgb.width - x0), sh = Math.min(side, rgb.height - y0)

  // Draw crop → 512 canvas
  const crop = document.createElement('canvas'); crop.width = sw; crop.height = sh
  const cctx = crop.getContext('2d')!
  const tmp = document.createElement('canvas'); tmp.width = rgb.width; tmp.height = rgb.height
  tmp.getContext('2d')!.putImageData(rgb, 0, 0)
  cctx.drawImage(tmp, x0, y0, sw, sh, 0, 0, sw, sh)

  const maskC = document.createElement('canvas'); maskC.width = sw; maskC.height = sh
  const mctx = maskC.getContext('2d')!
  const mt = document.createElement('canvas'); mt.width = eraseMask.width; mt.height = eraseMask.height
  mt.getContext('2d')!.putImageData(eraseMask, 0, 0)
  mctx.drawImage(mt, x0, y0, sw, sh, 0, 0, sw, sh)

  const inC = document.createElement('canvas'); inC.width = SIZE; inC.height = SIZE
  const ictx = inC.getContext('2d')!
  ictx.fillStyle = '#000'; ictx.fillRect(0, 0, SIZE, SIZE)
  ictx.drawImage(crop, 0, 0, SIZE, SIZE)
  const imgData = ictx.getImageData(0, 0, SIZE, SIZE)

  const mIn = document.createElement('canvas'); mIn.width = SIZE; mIn.height = SIZE
  const mix = mIn.getContext('2d')!
  mix.fillStyle = '#000'; mix.fillRect(0, 0, SIZE, SIZE)
  mix.drawImage(maskC, 0, 0, SIZE, SIZE)
  const mData = mix.getImageData(0, 0, SIZE, SIZE)

  const image = new Float32Array(1 * 3 * SIZE * SIZE)
  const mask = new Float32Array(1 * 1 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const p = y * SIZE + x
    image[p] = imgData.data[i] / 255
    image[SIZE * SIZE + p] = imgData.data[i + 1] / 255
    image[2 * SIZE * SIZE + p] = imgData.data[i + 2] / 255
    mask[p] = mData.data[i] > 20 ? 1 : 0
  }

  onProgress?.(50, 'Inpainting…')
  const feeds: Record<string, ort.Tensor> = {
    image: new ort.Tensor('float32', image, [1, 3, SIZE, SIZE]),
    mask: new ort.Tensor('float32', mask, [1, 1, SIZE, SIZE]),
  }
  const out = await session.run(feeds)
  const outT = out[session.outputNames[0]] as ort.Tensor
  const o = outT.data as Float32Array

  const outImg = ictx.createImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = y * SIZE + x, i = p * 4
    outImg.data[i] = Math.min(255, Math.max(0, o[p]))
    outImg.data[i + 1] = Math.min(255, Math.max(0, o[SIZE * SIZE + p]))
    outImg.data[i + 2] = Math.min(255, Math.max(0, o[2 * SIZE * SIZE + p]))
    // LaMa (Carve) outputs 0–255 floats even when input is 0–1
    outImg.data[i + 3] = 255
  }
  ictx.putImageData(outImg, 0, 0)

  // Soft-blend inpainted crop back using a slightly dilated erase mask
  const result = cloneImageData(rgb)
  const rC = document.createElement('canvas'); rC.width = rgb.width; rC.height = rgb.height
  const rctx = rC.getContext('2d')!
  rctx.putImageData(rgb, 0, 0)
  rctx.drawImage(inC, 0, 0, SIZE, SIZE, x0, y0, sw, sh)
  const blended = rctx.getImageData(0, 0, rgb.width, rgb.height)
  // Dilate mask ~2px so hard brush edges don't leave remnants
  const alpha = new Float32Array(rgb.width * rgb.height)
  for (let i = 0, p = 0; i < eraseMask.data.length; i += 4, p++) alpha[p] = eraseMask.data[i] / 255
  const dil = new Float32Array(alpha)
  for (let y = 1; y < rgb.height - 1; y++) for (let x = 1; x < rgb.width - 1; x++) {
    const p = y * rgb.width + x
    if (alpha[p] > 0.5) continue
    let m = 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m = Math.max(m, alpha[(y + dy) * rgb.width + (x + dx)])
    dil[p] = m * 0.85
  }
  for (let i = 0, p = 0; i < result.data.length; i += 4, p++) {
    const a = dil[p]
    if (a < 0.01) continue
    result.data[i] = blended.data[i] * a + result.data[i] * (1 - a)
    result.data[i + 1] = blended.data[i + 1] * a + result.data[i + 1] * (1 - a)
    result.data[i + 2] = blended.data[i + 2] * a + result.data[i + 2] * (1 - a)
  }
    onProgress?.(100, 'Done')
  return result
}
