import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../lib/types'

export type BrushMode = 'none' | 'erase' | 'restore' | 'paint'

type Props = {
  doc: Doc
  preview: HTMLCanvasElement | null
  showOriginal: boolean
  brush: BrushMode
  brushSize: number // in doc pixels (relative to longest side /1000)
  hardness: number
  /** Eraser overlay mask (white = selected), same size as doc */
  paintMask: ImageData | null
  onStrokeStart: () => void
  onStroke: (x: number, y: number, r: number) => void
  onStrokeEnd: () => void
  checker: boolean
  progress: { pct: number; label: string } | null
}

export function Stage(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fit, setFit] = useState(1)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [hand, setHand] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ mode: 'pan' | 'brush' | 'pinch'; sx: number; sy: number; px: number; py: number; dist?: number; z?: number } | null>(null)
  const space = useRef(false)

  const radius = (p.brushSize * Math.max(p.doc.width, p.doc.height)) / 1000

  // Fit to container
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const calc = () => {
      const r = el.getBoundingClientRect()
      setFit(Math.min((r.width - 32) / p.doc.width, (r.height - 32) / p.doc.height, 4))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [p.doc.width, p.doc.height])

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [p.doc.id])

  // Draw preview
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = p.doc.width; c.height = p.doc.height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (p.showOriginal) { const o = document.createElement('canvas'); o.width = p.doc.original.width; o.height = p.doc.original.height; o.getContext('2d')!.putImageData(p.doc.original, 0, 0); ctx.drawImage(o, 0, 0, c.width, c.height) }
    else if (p.preview) ctx.drawImage(p.preview, 0, 0, c.width, c.height)
  }, [p.preview, p.showOriginal, p.doc])

  // Draw paint overlay
  useEffect(() => {
    const c = overlayRef.current
    if (!c) return
    c.width = p.doc.width; c.height = p.doc.height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (!p.paintMask) return
    const o = ctx.createImageData(c.width, c.height)
    const m = p.paintMask.data
    for (let i = 0; i < m.length; i += 4) if (m[i] > 0) { o.data[i] = 236; o.data[i + 1] = 72; o.data[i + 2] = 153; o.data[i + 3] = m[i] * 0.55 }
    ctx.putImageData(o, 0, 0)
  })

  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') { space.current = true; e.preventDefault() } }
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [])

  const scale = fit * zoom

  const toDoc = (cx: number, cy: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: ((cx - r.left) / r.width) * p.doc.width, y: ((cy - r.top) / r.height) * p.doc.height }
  }

  const onWheel = (e: React.WheelEvent) => {
    const f = Math.exp(-e.deltaY * 0.0015)
    setZoom((z) => Math.min(16, Math.max(0.2, z * f)))
  }

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      if (drag.current?.mode === 'brush') p.onStrokeEnd()
      drag.current = { mode: 'pinch', sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, px: pan.x, py: pan.y, dist: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }
      return
    }
    const usePan = hand || space.current || e.button === 1 || e.button === 2 || p.brush === 'none'
    if (usePan) {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    } else {
      drag.current = { mode: 'brush', sx: 0, sy: 0, px: 0, py: 0 }
      p.onStrokeStart()
      const d = toDoc(e.clientX, e.clientY)
      p.onStroke(d.x, d.y, radius)
    }
  }
  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const r = wrapRef.current!.getBoundingClientRect()
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
    const d = drag.current
    if (!d) return
    if (d.mode === 'pan') setPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy })
    else if (d.mode === 'brush') { const q = toDoc(e.clientX, e.clientY); p.onStroke(q.x, q.y, radius) }
    else if (d.mode === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      setZoom(Math.min(16, Math.max(0.2, d.z! * (dist / d.dist!))))
      setPan({ x: d.px + (a.x + b.x) / 2 - d.sx, y: d.py + (a.y + b.y) / 2 - d.sy })
    }
  }
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (drag.current?.mode === 'brush') p.onStrokeEnd()
    if (pointers.current.size === 0) drag.current = null
  }

  const brushing = p.brush !== 'none' && !hand
  const cursorPx = radius * scale * 2

  return (
    <div className="stage" ref={wrapRef} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setCursor(null)}
      style={{ cursor: brushing ? 'none' : drag.current?.mode === 'pan' ? 'grabbing' : 'grab', touchAction: 'none' }}>
      <div className="stage-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <div className={`stage-canvas ${p.checker ? 'checker' : ''}`} style={{ width: p.doc.width * scale, height: p.doc.height * scale }}>
          <canvas ref={canvasRef} data-testid="stage-canvas" />
          <canvas ref={overlayRef} className="overlay-canvas" />
        </div>
      </div>
      {brushing && cursor && <div className="brush-cursor" style={{ left: cursor.x, top: cursor.y, width: cursorPx, height: cursorPx }} />}
      {p.progress && (
        <div className="stage-progress fade-in">
          <div className="spinner" />
          <p>{p.progress.label}</p>
          <div className="bar"><i style={{ width: `${p.progress.pct}%` }} /></div>
        </div>
      )}
      <div className="zoom-ctl" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${hand ? 'on' : ''}`} title="Pan (or hold Space)" onClick={() => setHand((h) => !h)}>✋</button>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}>−</button>
        <button className="zoom-val" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>{Math.round(scale * 100)}%</button>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(16, z * 1.25))}>+</button>
      </div>
    </div>
  )
}
