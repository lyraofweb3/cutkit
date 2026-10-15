export type Bg =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; src: string; blur: number }
  | { kind: 'blur'; amount: number }

export type Shadow = { enabled: boolean; blur: number; offsetX: number; offsetY: number; opacity: number; color: string }
export type SizePreset = 'original' | 'square' | 'story' | 'amazon'
export type Tool =
  | 'cutout' | 'refine' | 'eraser' | 'upscale' | 'shadow' | 'background'
  | 'product' | 'generate' | 'expand' | 'tryon' | 'video' | 'export'

export type Doc = {
  id: string
  name: string
  /** Original raster */
  original: ImageData
  width: number
  height: number
  /** Alpha mask 0–255, same size (1 channel stored as ImageData R=G=B=A) */
  mask: ImageData
  /** Working RGB (after magic erase / upscale edits), same size as mask */
  rgb: ImageData
}

export const SIZE_LABELS: Record<SizePreset, string> = {
  original: 'Original',
  square: 'Square 1080×1080',
  story: 'Story 1080×1920',
  amazon: 'Amazon 2000×2000',
}

export const TOOLS: { id: Tool; label: string; icon: string; group: string; needsKey?: boolean }[] = [
  { id: 'cutout', label: 'Remove BG', icon: '✂️', group: 'Edit' },
  { id: 'refine', label: 'Refine', icon: '🖌️', group: 'Edit' },
  { id: 'eraser', label: 'Magic Eraser', icon: '🪄', group: 'Edit' },
  { id: 'upscale', label: 'Upscale', icon: '🔍', group: 'Edit' },
  { id: 'shadow', label: 'Shadow', icon: '🌑', group: 'Style' },
  { id: 'background', label: 'Background', icon: '🎨', group: 'Style' },
  { id: 'product', label: 'Product Shot', icon: '📦', group: 'AI', needsKey: true },
  { id: 'generate', label: 'AI Generate', icon: '✨', group: 'AI', needsKey: true },
  { id: 'expand', label: 'Expand', icon: '↔️', group: 'AI', needsKey: true },
  { id: 'tryon', label: 'Try-On', icon: '👕', group: 'AI', needsKey: true },
  { id: 'video', label: 'Video BG', icon: '🎬', group: 'AI' },
  { id: 'export', label: 'Export', icon: '⬇️', group: 'Export' },
]
