import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { Home } from './components/Home'
import { Settings } from './components/Settings'
import { Stage, type BrushMode } from './components/Stage'
import { docFromFile, removeBg } from './lib/cutout'
import { History } from './lib/history'
import { baseName, blobToImageData, download, extractAlpha, imageDataToBlob, imageDataToDataUrl, stripAlpha, composeRGBA } from './lib/image'
import { render, renderBlob } from './lib/render'
import { FAL_MODELS, FalKeyMissing, falRun, firstImageUrl, getFalKey, urlToBlob } from './lib/fal'
import { SIZE_LABELS, TOOLS, type Bg, type Doc, type Shadow, type SizePreset, type Tool } from './lib/types'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const COLORS = ['#ffffff', '#000000', '#f4f4f5', '#fde68a', '#bfdbfe', '#fbcfe8', '#bbf7d0', '#fecaca']
const GRADIENTS: [string, string][] = [['#a78bfa', '#f472b6'], ['#60a5fa', '#34d399'], ['#fbbf24', '#f87171'], ['#e0e7ff', '#ffffff'], ['#0f172a', '#334155']]
const NO_SHADOW: Shadow = { enabled: false, blur: 30, offsetX: 0, offsetY: 18, opacity: 0.35, color: '#000000' }

type Progress = { pct: number; label: string } | null

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('cutkit.theme') as 'dark' | 'light') || 'dark')
  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [tool, setTool] = useState<Tool>('cutout')
  const [screen, setScreen] = useState<'home' | 'editor'>('home')
  const [bg, setBg] = useState<Bg>({ kind: 'transparent' })
  const [shadow, setShadow] = useState<Shadow>(NO_SHADOW)
  const [size, setSize] = useState<SizePreset>('original')
  const [progress, setProgress] = useState<Progress>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)
  const [settings, setSettings] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [brushSize, setBrushSize] = useState(25)
  const [hardness, setHardness] = useState(0.6)
  const [refineMode, setRefineMode] = useState<'erase' | 'restore'>('erase')
  const [paintMask, setPaintMask] = useState<ImageData | null>(null)
  const paintMaskRef = useRef<ImageData | null>(null)
  useEffect(() => { paintMaskRef.current = paintMask }, [paintMask])
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  const [version, setVersion] = useState(0)
  const [cutDone, setCutDone] = useState<Record<string, boolean>>({})
  const [prompt, setPrompt] = useState('')
  const [garment, setGarment] = useState<string>('')
  const [expandRatio, setExpandRatio] = useState('16:9')
  const [drag, setDrag] = useState(false)
  const histories = useRef(new Map<string, History>())
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingTool = useRef<Tool | null>(null)

  const doc = docs.find((d) => d.id === activeId) ?? docs[0]
  const hist = doc ? (histories.current.get(doc.id) ?? histories.current.set(doc.id, new History()).get(doc.id)!) : null

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('cutkit.theme', theme) }, [theme])

  const toastTimer = useRef<number>(0)
  const notify = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    window.clearTimeout(toastTimer.current)
    setToast({ msg, kind }); toastTimer.current = window.setTimeout(() => setToast(null), kind === 'err' ? 9000 : 2800)
  }, [])

  // --- Preview rendering (throttled with rAF) ---
  const raf = useRef(0)
  useEffect(() => {
    if (!doc) return
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(async () => {
      const c = await render(doc, { bg, shadow, size: 'original' })
      setPreview(c)
    })
  }, [doc, bg, shadow, version])

  const updateDoc = (d: Doc) => { setDocs((xs) => xs.map((x) => (x.id === d.id ? d : x))); setVersion((v) => v + 1) }
  const commit = (next: Doc) => { hist?.push(doc!); updateDoc(next) }

  // --- Files ---
  const addFiles = useCallback(async (files: FileList | File[], openTool?: Tool) => {
    const ok = Array.from(files).filter((f) => ACCEPT.includes(f.type))
    if (!ok.length) return notify('Please choose JPG, PNG or WebP images.', 'err')
    const newDocs = await Promise.all(ok.map(docFromFile))
    setDocs((xs) => [...xs, ...newDocs])
    setActiveId(newDocs[0].id)
    setScreen('editor')
    const t = openTool ?? pendingTool.current
    if (t) setTool(t)
    pendingTool.current = null
  }, [notify])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const f = e.clipboardData?.files; if (f?.length) addFiles(f) }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  // --- Undo/redo keyboard ---
  const undo = () => { if (!doc || !hist) return; const d = hist.undo(doc); if (d) updateDoc(d) }
  const redo = () => { if (!doc || !hist) return; const d = hist.redo(doc); if (d) updateDoc(d) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (e.key === '[') setBrushSize((s) => Math.max(2, s - 3))
      else if (e.key === ']') setBrushSize((s) => Math.min(150, s + 3))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // --- Long task wrapper ---
  const task = async <T,>(fn: (p: (pct: number, label: string) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setProgress({ pct: 0, label: 'Starting…' })
    try { return await fn((pct, label) => setProgress({ pct, label })) }
    catch (e) {
      console.error(e)
      if (e instanceof FalKeyMissing) { notify(e.message, 'err'); setSettings(true) }
      else notify(`Failed: ${(e as Error)?.message ?? e}`, 'err')
    } finally { setBusy(false); setProgress(null) }
  }

  // --- Tools ---
  const runCutout = async (d: Doc = doc!) => {
    const r = await task((p) => {
      const blob = imageDataToBlob(composeRGBA(d.rgb, fullMask(d)))
      return blob.then((b) => removeBg(b, p))
    })
    if (!r) return
    histories.current.get(d.id)?.push(d) ?? histories.current.set(d.id, new History()).get(d.id)!.push(d)
    updateDoc(r.width === d.width && r.height === d.height ? { ...d, mask: r.mask } : { ...d, rgb: r.rgb, mask: r.mask, width: r.width, height: r.height })
    setCutDone((c) => ({ ...c, [d.id]: true }))
    if (d.id === doc?.id) notify('Background removed ✓')
  }

  const runBatch = async () => {
    const todo = docs.filter((d) => !cutDone[d.id])
    for (let i = 0; i < todo.length; i++) {
      setActiveId(todo[i].id)
      notify(`Batch ${i + 1} / ${todo.length}`)
      await runCutout(todo[i])
    }
    notify(`Batch done: ${todo.length} image(s)`)
  }

  // Refine brush
  const strokeSnap = useRef(false)
  const onStrokeStart = () => {
    if (!doc) return
    if (tool === 'refine') { hist?.push(doc); strokeSnap.current = true }
  }
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const dab = (target: ImageData, x: number, y: number, r: number, value: number, hard: number, srcOriginal?: ImageData) => {
    const W = target.width, H = target.height
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r))
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r))
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const dd = Math.hypot(xx - x, yy - y) / r
      if (dd > 1) continue
      const f = dd < hard ? 1 : 1 - (dd - hard) / (1 - hard + 1e-6)
      const i = (yy * W + xx) * 4
      const cur = target.data[i]
      const v = value === 255 ? Math.max(cur, 255 * f) : Math.min(cur, cur * (1 - f))
      target.data[i] = target.data[i + 1] = target.data[i + 2] = v
      target.data[i + 3] = 255
      if (srcOriginal && value === 255 && f > 0) {
        // restore original pixels where restoring (in case RGB was modified)
      }
    }
  }
  const onStroke = (x: number, y: number, r: number) => {
    if (!doc) return
    const pts: { x: number; y: number }[] = []
    const lp = lastPt.current
    if (lp) {
      const dist = Math.hypot(x - lp.x, y - lp.y), step = Math.max(1, r / 3)
      for (let s = step; s < dist; s += step) pts.push({ x: lp.x + ((x - lp.x) * s) / dist, y: lp.y + ((y - lp.y) * s) / dist })
    }
    pts.push({ x, y }); lastPt.current = { x, y }
    if (tool === 'refine') {
      for (const pt of pts) dab(doc.mask, pt.x, pt.y, r, refineMode === 'restore' ? 255 : 0, hardness)
      setVersion((v) => v + 1)
    } else if (tool === 'eraser') {
      setPaintMask((m) => {
        const base = m ?? new ImageData(doc.width, doc.height)
        // Always clone so React sees a new buffer and we never race with an empty mask
        const mm = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height)
        for (const pt of pts) dab(mm, pt.x, pt.y, r, 255, 0.8)
        return mm
      })
    }
  }
  const onStrokeEnd = () => { lastPt.current = null; strokeSnap.current = false; if (tool === 'refine') setDocs((xs) => [...xs]) }

  const runMagicErase = async () => {
    const mask = paintMaskRef.current
    if (!doc || !mask) return notify('Brush over what you want to remove first.', 'err')
    let painted = 0
    for (let i = 0; i < mask.data.length; i += 4) if (mask.data[i] > 20) painted++
    if (!painted) return notify('Brush over what you want to remove first.', 'err')
    const maskCopy = new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height)
    const r = await task(async (p) => { const { magicErase } = await import('./lib/lama'); return magicErase(doc.rgb, maskCopy, p) })
    if (!r) return
    commit({ ...doc, rgb: r })
    setPaintMask(null)
    notify('Object erased ✓')
  }

  const runUpscale = async (scale: 2 | 4) => {
    if (!doc) return
    const px = doc.width * doc.height * scale * scale
    if (px > 36e6) return notify(`Too large for ${scale}× in-browser (max ~36 MP output). Try 2× or a smaller image.`, 'err')
    const r = await task(async (p) => { const { upscale } = await import('./lib/upscale'); return upscale(doc.rgb, doc.mask, scale, p) })
    if (!r) return
    commit({ ...doc, rgb: r.rgb, mask: r.mask, width: r.rgb.width, height: r.rgb.height })
    notify(`Upscaled to ${r.rgb.width}×${r.rgb.height} ✓`)
  }

  // --- fal tools ---
  const docDataUrl = async (withAlpha = true, maxSide = 1536) => {
    const c = await render(doc!, { bg: withAlpha ? { kind: 'transparent' } : bg, shadow: NO_SHADOW, size: 'original' })
    const s = Math.min(1, maxSide / Math.max(c.width, c.height))
    const o = document.createElement('canvas'); o.width = Math.round(c.width * s); o.height = Math.round(c.height * s)
    o.getContext('2d')!.drawImage(c, 0, 0, o.width, o.height)
    return o.toDataURL('image/png')
  }
  const loadResultAsNewDoc = async (url: string, name: string) => {
    const blob = await urlToBlob(url)
    const file = new File([blob], name, { type: blob.type || 'image/png' })
    const d = await docFromFile(file)
    setDocs((xs) => [...xs, d]); setActiveId(d.id)
  }
  const replaceDocFromUrl = async (url: string) => {
    const rgba = await blobToImageData(await urlToBlob(url))
    const mask = new ImageData(rgba.width, rgba.height); mask.data.fill(255)
    commit({ ...doc!, rgb: stripAlpha(rgba), mask: rgba.data.some((_, i) => i % 4 === 3 && rgba.data[i] < 255) ? extractAlpha(rgba) : mask, width: rgba.width, height: rgba.height })
    setBg({ kind: 'transparent' })
  }
  const needKey = () => { if (!getFalKey()) { notify('Add your fal.ai key in Settings to use AI tools.', 'err'); setSettings(true); return true } return false }

  const runProductShot = async () => {
    if (!doc || needKey()) return
    if (!prompt.trim()) return notify('Describe a scene, e.g. "on a marble counter, soft morning light"', 'err')
    await task(async (p) => {
      const image_url = await docDataUrl(true)
      const out = await falRun<{ images: { url: string }[] }>(FAL_MODELS.productShot, {
        image_url, scene_description: prompt.trim(), placement_type: 'original', num_results: 1, fast: true, sync_mode: false,
      }, (l) => p(50, l))
      await replaceDocFromUrl(firstImageUrl(out))
      notify('Product shot ready ✓')
    })
  }
  const runGenerate = async (mode: 'new' | 'edit') => {
    if (needKey()) return
    if (!prompt.trim()) return notify('Type a prompt first.', 'err')
    await task(async (p) => {
      if (mode === 'edit' && doc) {
        const image_url = await docDataUrl(false)
        const out = await falRun(FAL_MODELS.edit, { prompt: prompt.trim(), image_url }, (l) => p(50, l))
        await replaceDocFromUrl(firstImageUrl(out))
      } else {
        const out = await falRun(FAL_MODELS.generate, { prompt: prompt.trim(), image_size: 'square_hd', num_images: 1, enable_safety_checker: true }, (l) => p(50, l))
        await loadResultAsNewDoc(firstImageUrl(out), `generated-${Date.now()}.png`)
        setScreen('editor')
      }
      notify('Image ready ✓')
    })
  }
  const runExpand = async () => {
    if (!doc || needKey()) return
    await task(async (p) => {
      const image_url = await docDataUrl(false)
      const out = await falRun(FAL_MODELS.expand, { image_url, aspect_ratio: expandRatio, prompt: prompt.trim() }, (l) => p(50, l))
      await replaceDocFromUrl(firstImageUrl(out))
      notify('Image expanded ✓')
    })
  }
  const runTryOn = async () => {
    if (!doc || needKey()) return
    if (!garment) return notify('Upload a garment image first.', 'err')
    await task(async (p) => {
      const human_image_url = await docDataUrl(false, 1024)
      const out = await falRun(FAL_MODELS.tryon, { human_image_url, garment_image_url: garment, prompt: prompt.trim() || 'A natural studio photo of the person wearing the garment.' }, (l) => p(50, l))
      await replaceDocFromUrl(firstImageUrl(out))
      notify('Try-on ready ✓')
    })
  }

  // --- Export ---
  const exportOne = async (fmt: 'png' | 'jpg') => {
    if (!doc) return
    download(await renderBlob(doc, { bg, shadow, size }, fmt), `${baseName(doc.name)}-cutkit.${fmt}`)
  }
  const exportZip = async (fmt: 'png' | 'jpg') => {
    await task(async (p) => {
      const zip = new JSZip(); const used = new Set<string>()
      for (let i = 0; i < docs.length; i++) {
        let n = `${baseName(docs[i].name)}-cutkit`, k = 1
        while (used.has(n)) n = `${baseName(docs[i].name)}-cutkit-${++k}`
        used.add(n)
        zip.file(`${n}.${fmt}`, await renderBlob(docs[i], { bg, shadow, size }, fmt))
        p(Math.round(((i + 1) / docs.length) * 100), `Rendering ${i + 1}/${docs.length}…`)
      }
      download(await zip.generateAsync({ type: 'blob' }), 'cutkit-images.zip')
    })
  }

  const removeDoc = (id: string) => {
    setDocs((xs) => { const n = xs.filter((x) => x.id !== id); if (!n.length) setScreen('home'); return n })
    if (activeId === id) setActiveId(undefined)
  }

  const pickTool = (t: Tool) => {
    if (t === 'generate') { setTool(t); setScreen('editor'); return }
    if (docs.length) { setTool(t); setScreen('editor') }
    else { pendingTool.current = t; fileInput.current?.click() }
  }

  const brush: BrushMode = tool === 'refine' ? refineMode : tool === 'eraser' ? 'paint' : 'none'
  const isCut = doc ? !!cutDone[doc.id] : false
  const thumbs = useMemo(() => docs.map((d) => ({ id: d.id, url: thumbUrl(d) })), [docs])

  const onUploadBg = async (f: File) => setBg({ kind: 'image', src: URL.createObjectURL(f), blur: 0 })
  const onUploadGarment = async (f: File) => {
    const id = await blobToImageData(f)
    setGarment(await imageDataToDataUrl(downscale(id, 1024)))
  }

  return (
    <div className="app" onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}>
      <input ref={fileInput} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />

      <header className="topbar">
        <button className="brand" onClick={() => setScreen('home')}><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" /> CutKit</button>
        {screen === 'editor' && doc && (
          <div className="top-actions">
            <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!hist?.canUndo || busy} onClick={undo}>↶</button>
            <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!hist?.canRedo || busy} onClick={redo}>↷</button>
            <button className="btn ghost hide-sm" onPointerDown={() => setShowOriginal(true)} onPointerUp={() => setShowOriginal(false)} onPointerLeave={() => setShowOriginal(false)}>👁 Hold to compare</button>
          </div>
        )}
        <div className="top-right">
          <button className="icon-btn" title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="icon-btn" title="Settings" onClick={() => setSettings(true)}>⚙️</button>
          {screen === 'editor' && doc && <button className="btn primary" onClick={() => exportOne('png')}>Download</button>}
        </div>
      </header>

      {screen === 'home' || (!doc && tool !== 'generate') ? (
        <Home onPick={pickTool} onFiles={addFiles} />
      ) : (
        <div className="editor fade-in">
          <nav className="toolbar">
            {TOOLS.map((t) => (
              <button key={t.id} className={`tb ${tool === t.id ? 'on' : ''}`} onClick={() => setTool(t.id)} data-tool={t.id}>
                <span>{t.icon}</span><small>{t.label}</small>
              </button>
            ))}
          </nav>

          <main className="canvas-area">
            {doc ? (
              <Stage doc={doc} preview={preview} showOriginal={showOriginal} brush={brush} brushSize={brushSize} hardness={hardness}
                paintMask={tool === 'eraser' ? paintMask : null} onStrokeStart={onStrokeStart} onStroke={onStroke} onStrokeEnd={onStrokeEnd}
                checker={bg.kind === 'transparent' && !showOriginal} progress={progress} />
            ) : (
              <div className="empty">{progress ? <><div className="spinner" /><p>{progress.label}</p></> : <p className="muted">Type a prompt to generate your first image →</p>}</div>
            )}
            <div className="filmstrip">
              {thumbs.map((t) => (
                <div key={t.id} className={`thumb ${t.id === doc?.id ? 'sel' : ''}`} onClick={() => setActiveId(t.id)}>
                  <img src={t.url} alt="" className="checker" />
                  {cutDone[t.id] && <span className="tick">✓</span>}
                  {!busy && <button className="x" onClick={(e) => { e.stopPropagation(); removeDoc(t.id) }}>×</button>}
                </div>
              ))}
              <button className="thumb add" onClick={() => fileInput.current?.click()}>＋</button>
            </div>
          </main>

          <aside className="panel slide-in" key={tool}>
            {tool === 'cutout' && <>
              <h3>Remove background</h3>
              <p className="muted small">AI cutout runs on your device. The first run downloads the model (~40–80 MB).</p>
              <button className="btn primary wide" data-testid="remove-bg" disabled={busy || !doc} onClick={() => runCutout()}>{isCut ? 'Run again' : '✨ Remove background'}</button>
              {docs.length > 1 && <button className="btn wide" disabled={busy} onClick={runBatch}>Batch: process all ({docs.filter((d) => !cutDone[d.id]).length})</button>}
              {isCut && <p className="ok">✓ Done. Use Refine to touch up edges.</p>}
            </>}

            {tool === 'refine' && <>
              <h3>Refine cutout</h3>
              <div className="seg">
                <button className={refineMode === 'erase' ? 'on' : ''} onClick={() => setRefineMode('erase')} data-testid="refine-erase">Erase</button>
                <button className={refineMode === 'restore' ? 'on' : ''} onClick={() => setRefineMode('restore')} data-testid="refine-restore">Restore</button>
              </div>
              <Slider label="Brush size" value={brushSize} min={2} max={150} onChange={setBrushSize} />
              <Slider label="Hardness" value={Math.round(hardness * 100)} min={0} max={95} onChange={(v) => setHardness(v / 100)} />
              <p className="muted small">Paint to erase or bring back parts of the subject. Scroll / pinch to zoom, hold Space or use ✋ to pan. [ and ] change size.</p>
            </>}

            {tool === 'eraser' && <>
              <h3>Magic Eraser</h3>
              <p className="muted small">Brush over objects, people or text to remove them. Uses the LaMa model in your browser (~200 MB download on first use, then cached).</p>
              <Slider label="Brush size" value={brushSize} min={2} max={150} onChange={setBrushSize} />
              <button className="btn primary wide" data-testid="magic-erase" disabled={busy || !paintMask} onClick={runMagicErase}>🪄 Erase selection</button>
              <button className="btn wide" disabled={!paintMask} onClick={() => setPaintMask(null)}>Clear selection</button>
            </>}

            {tool === 'upscale' && <>
              <h3>Upscale</h3>
              <p className="muted small">Swin2SR super-resolution in your browser. Current size: {doc?.width}×{doc?.height}. Large images take a while.</p>
              <div className="row">
                <button className="btn primary" data-testid="upscale-2" disabled={busy || !doc} onClick={() => runUpscale(2)}>2×</button>
                <button className="btn primary" data-testid="upscale-4" disabled={busy || !doc} onClick={() => runUpscale(4)}>4×</button>
              </div>
            </>}

            {tool === 'shadow' && <>
              <h3>Shadow</h3>
              <label className="switch"><input type="checkbox" data-testid="shadow-toggle" checked={shadow.enabled} onChange={(e) => setShadow({ ...shadow, enabled: e.target.checked })} /><span>Drop shadow</span></label>
              <div className="presets">
                <button className="btn" onClick={() => setShadow({ ...shadow, enabled: true, blur: 40, offsetX: 0, offsetY: 10, opacity: 0.3 })}>Soft</button>
                <button className="btn" onClick={() => setShadow({ ...shadow, enabled: true, blur: 8, offsetX: 12, offsetY: 16, opacity: 0.45 })}>Hard</button>
                <button className="btn" onClick={() => setShadow({ ...shadow, enabled: true, blur: 60, offsetX: 0, offsetY: 40, opacity: 0.25 })}>Float</button>
              </div>
              <Slider label="Blur" value={shadow.blur} min={0} max={120} onChange={(v) => setShadow({ ...shadow, enabled: true, blur: v })} />
              <Slider label="Offset X" value={shadow.offsetX} min={-80} max={80} onChange={(v) => setShadow({ ...shadow, enabled: true, offsetX: v })} />
              <Slider label="Offset Y" value={shadow.offsetY} min={-80} max={80} onChange={(v) => setShadow({ ...shadow, enabled: true, offsetY: v })} />
              <Slider label="Opacity" value={Math.round(shadow.opacity * 100)} min={0} max={100} onChange={(v) => setShadow({ ...shadow, enabled: true, opacity: v / 100 })} />
              <label className="field inline"><span>Colour</span><input type="color" value={shadow.color} onChange={(e) => setShadow({ ...shadow, enabled: true, color: e.target.value })} /></label>
            </>}

            {tool === 'background' && <>
              <h3>Background</h3>
              <div className="swatches">
                <button className={`sw checker ${bg.kind === 'transparent' ? 'on' : ''}`} title="Transparent" onClick={() => setBg({ kind: 'transparent' })} />
                {COLORS.map((c) => <button key={c} className={`sw ${bg.kind === 'solid' && bg.color === c ? 'on' : ''}`} title={c} style={{ background: c }} onClick={() => setBg({ kind: 'solid', color: c })} />)}
                <label className="sw picker" title="Custom"><input type="color" onChange={(e) => setBg({ kind: 'solid', color: e.target.value })} />🎨</label>
              </div>
              <h4>Gradients</h4>
              <div className="swatches">
                {GRADIENTS.map(([a, b]) => <button key={a + b} className={`sw ${bg.kind === 'gradient' && bg.from === a ? 'on' : ''}`} style={{ background: `linear-gradient(135deg,${a},${b})` }} onClick={() => setBg({ kind: 'gradient', from: a, to: b, angle: 135 })} />)}
              </div>
              {bg.kind === 'gradient' && <div className="row">
                <input type="color" value={bg.from} onChange={(e) => setBg({ ...bg, from: e.target.value })} />
                <input type="color" value={bg.to} onChange={(e) => setBg({ ...bg, to: e.target.value })} />
                <input type="range" min={0} max={360} value={bg.angle} onChange={(e) => setBg({ ...bg, angle: +e.target.value })} />
              </div>}
              <h4>Photo & blur</h4>
              <div className="row">
                <label className="btn"><input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUploadBg(e.target.files[0])} />🖼 Upload photo</label>
                <button className={`btn ${bg.kind === 'blur' ? 'on' : ''}`} data-testid="bg-blur" onClick={() => setBg({ kind: 'blur', amount: 20 })}>💧 Blur original</button>
              </div>
              {bg.kind === 'image' && <Slider label="Photo blur" value={bg.blur} min={0} max={60} onChange={(v) => setBg({ ...bg, blur: v })} />}
              {bg.kind === 'blur' && <Slider label="Blur amount" value={bg.amount} min={2} max={60} onChange={(v) => setBg({ ...bg, amount: v })} />}
              {!isCut && <p className="muted small">Tip: remove the background first so the new one shows.</p>}
            </>}

            {tool === 'product' && <FalPanel title="AI Product Shot" desc="Places your product in a generated scene (Bria Product Shot, licensed-data model).">
              <textarea placeholder="e.g. on a marble kitchen counter, soft morning light" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <div className="chips">{['on a marble counter, soft daylight', 'on a beach at sunset', 'minimal pastel podium, studio light', 'on a wooden table with plants'].map((s) => <button key={s} className="chip" onClick={() => setPrompt(s)}>{s}</button>)}</div>
              <button className="btn primary wide" data-testid="fal-product" disabled={busy || !doc} onClick={runProductShot}>📦 Generate scene</button>
            </FalPanel>}

            {tool === 'generate' && <FalPanel title="AI Generate & Edit" desc="Create a new image (FLUX.1 schnell) or edit the current one with a prompt (FLUX.1 Kontext pro).">
              <textarea placeholder="e.g. a sneaker floating over a neon city, product photo" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <button className="btn primary wide" data-testid="fal-generate" disabled={busy} onClick={() => runGenerate('new')}>✨ Generate new image</button>
              {doc && <button className="btn wide" disabled={busy} onClick={() => runGenerate('edit')}>✏️ Edit current image</button>}
            </FalPanel>}

            {tool === 'expand' && <FalPanel title="Expand (outpaint)" desc="Extends the image beyond its borders (Bria Expand).">
              <div className="sizes">{['1:1', '4:5', '3:2', '16:9', '9:16', '2:3'].map((r) => <button key={r} className={`btn ${expandRatio === r ? 'on' : ''}`} onClick={() => setExpandRatio(r)}>{r}</button>)}</div>
              <textarea placeholder="Optional prompt for the new area" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <button className="btn primary wide" data-testid="fal-expand" disabled={busy || !doc} onClick={runExpand}>↔️ Expand</button>
            </FalPanel>}

            {tool === 'tryon' && <FalPanel title="Virtual Try-On" desc="Current image = person. Upload a garment photo (FLUX Virtual Try-On).">
              <label className="btn wide"><input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUploadGarment(e.target.files[0])} />👕 {garment ? 'Change garment' : 'Upload garment'}</label>
              {garment && <img src={garment} className="garment" alt="garment" />}
              <textarea placeholder="Optional: e.g. tucked in, front-facing studio shot" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <button className="btn primary wide" data-testid="fal-tryon" disabled={busy || !doc} onClick={runTryOn}>Try it on</button>
            </FalPanel>}

            {tool === 'export' && <>
              <h3>Export</h3>
              <h4>Size</h4>
              <div className="sizes">{(Object.keys(SIZE_LABELS) as SizePreset[]).map((s) => <button key={s} className={`btn ${size === s ? 'on' : ''}`} onClick={() => setSize(s)}>{SIZE_LABELS[s]}</button>)}</div>
              {size === 'amazon' && <p className="muted small">Product trimmed & centred with padding on 2000×2000.</p>}
              <h4>This image</h4>
              <div className="row">
                <button className="btn primary" data-testid="export-png" disabled={!doc || busy} onClick={() => exportOne('png')}>PNG</button>
                <button className="btn" data-testid="export-jpg" disabled={!doc || busy} onClick={() => exportOne('jpg')}>JPG</button>
              </div>
              {docs.length > 1 && <>
                <h4>All {docs.length} images (batch)</h4>
                <button className="btn wide" disabled={busy} onClick={runBatch}>Remove all backgrounds</button>
                <div className="row">
                  <button className="btn" disabled={busy} onClick={() => exportZip('png')}>ZIP · PNG</button>
                  <button className="btn" disabled={busy} onClick={() => exportZip('jpg')}>ZIP · JPG</button>
                </div>
              </>}
              {bg.kind === 'transparent' && <p className="muted small">JPG has no transparency — white is used.</p>}
            </>}
          </aside>
        </div>
      )}

      {drag && <div className="drop-overlay fade-in">Drop images to add</div>}
      {settings && <Settings onClose={() => setSettings(false)} theme={theme} setTheme={setTheme} />}
      {toast && <div className={`toast ${toast.kind} pop-in`} data-testid="toast" role="status">{toast.msg}</div>}
    </div>
  )
}

function FalPanel({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  const has = !!getFalKey()
  return <>
    <h3>{title} <em className="badge">fal.ai</em></h3>
    <p className="muted small">{desc}</p>
    {!has && <div className="keybox" data-testid="fal-missing">🔑 Add your fal.ai API key in <b>Settings ⚙️</b> to use this tool. Your key stays in this browser. Billed to your fal account.</div>}
    {children}
  </>
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <label className="slider-field"><span>{label}<b>{value}</b></span><input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} /></label>
}

function fullMask(d: Doc) { const m = new ImageData(d.width, d.height); m.data.fill(255); return m }

function downscale(id: ImageData, max: number): ImageData {
  const s = Math.min(1, max / Math.max(id.width, id.height))
  const c = document.createElement('canvas'); c.width = id.width; c.height = id.height
  c.getContext('2d')!.putImageData(id, 0, 0)
  const o = document.createElement('canvas'); o.width = Math.round(id.width * s); o.height = Math.round(id.height * s)
  const ctx = o.getContext('2d')!; ctx.drawImage(c, 0, 0, o.width, o.height)
  return ctx.getImageData(0, 0, o.width, o.height)
}

function thumbUrl(d: Doc): string {
  const s = 120 / Math.max(d.width, d.height)
  const src = document.createElement('canvas'); src.width = d.width; src.height = d.height
  src.getContext('2d')!.putImageData(composeRGBA(d.rgb, d.mask), 0, 0)
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(d.width * s)); c.height = Math.max(1, Math.round(d.height * s))
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL()
}
