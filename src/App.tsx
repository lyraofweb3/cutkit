import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { baseName, compose, cutout, download, SIZE_LABELS, type Bg, type SizePreset } from './lib'

type Item = { id: string; file: File; src: string; cut?: Blob; cutSrc?: string; status: 'queued' | 'working' | 'done' | 'error'; error?: string }
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const PRESETS = ['#ffffff', '#000000', '#f3f4f6', '#fde68a', '#bfdbfe', '#fbcfe8', '#bbf7d0']
const GRADIENTS: [string, string][] = [['#a78bfa', '#f472b6'], ['#60a5fa', '#34d399'], ['#fbbf24', '#f87171'], ['#e0e7ff', '#ffffff']]

function bgCss(bg: Bg): React.CSSProperties {
  if (bg.kind === 'solid') return { background: bg.color }
  if (bg.kind === 'gradient') return { background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})` }
  return {}
}

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [bg, setBg] = useState<Bg>({ kind: 'transparent' })
  const [size, setSize] = useState<SizePreset>('original')
  const [view, setView] = useState<'after' | 'before' | 'compare'>('after')
  const [split, setSplit] = useState(50)
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [custom, setCustom] = useState('#ff6b6b')
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items); itemsRef.current = items

  const active = items.find((i) => i.id === activeId) ?? items[0]
  const update = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const addFiles = useCallback((files: FileList | File[]) => {
    const ok = Array.from(files).filter((f) => ACCEPT.includes(f.type))
    if (!ok.length) return alert('Please choose JPG, PNG or WebP images.')
    const newItems: Item[] = ok.map((file) => ({ id: crypto.randomUUID(), file, src: URL.createObjectURL(file), status: 'queued' }))
    setItems((xs) => [...xs, ...newItems])
    setActiveId(newItems[0].id)
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const f = e.clipboardData?.files; if (f?.length) addFiles(f) }
    window.addEventListener('paste', onPaste); return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const processOne = async (it: Item) => {
    update(it.id, { status: 'working', error: undefined })
    try {
      const cut = await cutout(it.file, (pct, label) => setProgress({ pct, label }))
      update(it.id, { cut, cutSrc: URL.createObjectURL(cut), status: 'done' })
    } catch (e) {
      console.error(e); update(it.id, { status: 'error', error: String((e as Error)?.message ?? e) })
    }
  }

  const run = async (targets: Item[]) => {
    setBusy(true)
    for (let i = 0; i < targets.length; i++) {
      setActiveId(targets[i].id)
      setProgress({ pct: 0, label: targets.length > 1 ? `Image ${i + 1} of ${targets.length}…` : 'Starting…' })
      await processOne(targets[i])
    }
    setProgress(null); setBusy(false)
  }

  const exportOne = async (it: Item, fmt: 'png' | 'jpg') => {
    if (!it.cut) return
    const blob = await compose(it.cut, bg, size, fmt)
    download(blob, `${baseName(it.file.name)}-cutkit.${fmt}`)
  }

  const exportZip = async (fmt: 'png' | 'jpg') => {
    const done = items.filter((i) => i.cut)
    if (!done.length) return
    setBusy(true); setProgress({ pct: 0, label: 'Building ZIP…' })
    const zip = new JSZip(); const used = new Set<string>()
    for (let i = 0; i < done.length; i++) {
      let name = `${baseName(done[i].file.name)}-cutkit`; let n = 1
      while (used.has(name)) name = `${baseName(done[i].file.name)}-cutkit-${++n}`
      used.add(name)
      zip.file(`${name}.${fmt}`, await compose(done[i].cut!, bg, size, fmt))
      setProgress({ pct: Math.round(((i + 1) / done.length) * 100), label: 'Building ZIP…' })
    }
    download(await zip.generateAsync({ type: 'blob' }), 'cutkit-images.zip')
    setProgress(null); setBusy(false)
  }

  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id))
  const pending = items.filter((i) => i.status === 'queued' || i.status === 'error')
  const doneCount = items.filter((i) => i.cut).length
  const stageStyle = useMemo(() => bgCss(bg), [bg])
  const aspect = size === 'square' || size === 'amazon' ? '1 / 1' : size === 'story' ? '9 / 16' : undefined

  return (
    <div className="app" onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}>
      <header>
        <div className="logo">✂️ <b>CutKit</b></div>
        <span className="tag">Free AI background remover · runs 100% in your browser</span>
      </header>
      <input ref={inputRef} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />

      {!items.length ? (
        <div className={`drop ${drag ? 'over' : ''}`} onClick={() => inputRef.current?.click()}>
          <div className="big">⬆️</div>
          <h1>Remove image backgrounds instantly</h1>
          <p>Drop JPG, PNG or WebP images here, paste, or <u>browse</u>. Select several for batch mode.</p>
          <button className="primary">Upload images</button>
          <small>Your photos never leave your device.</small>
        </div>
      ) : (
        <main>
          <section className="stagewrap">
            <div className="tabs">
              {(['before', 'after', 'compare'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
            </div>
            {active && (
              <div className={`stage ${drag ? 'over' : ''}`}>
                <div className="frame checker" style={{ aspectRatio: aspect }}>
                  <div className="fill" style={view === 'before' ? {} : stageStyle} />
                  {(view === 'before' || !active.cutSrc) && <img src={active.src} alt="original" />}
                  {view === 'after' && active.cutSrc && <img src={active.cutSrc} alt="cutout" />}
                  {view === 'compare' && active.cutSrc && <>
                    <img src={active.src} alt="original" style={{ clipPath: `inset(0 ${100 - split}% 0 0)`, zIndex: 2 }} />
                    <img src={active.cutSrc} alt="cutout" />
                    <div className="divider" style={{ left: `${split}%` }} />
                    <input className="slider" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} />
                  </>}
                  {active.status === 'working' && progress && <div className="overlay"><div className="spinner" /><p>{progress.label}</p><div className="bar"><i style={{ width: `${progress.pct}%` }} /></div><small>{progress.pct}%</small></div>}
                </div>
                {active.status === 'error' && <p className="err">Failed: {active.error}</p>}
              </div>
            )}
            <div className="thumbs">
              {items.map((it) => (
                <div key={it.id} className={`thumb ${it.id === active?.id ? 'sel' : ''}`} onClick={() => setActiveId(it.id)}>
                  <img src={it.cutSrc ?? it.src} alt="" className={it.cutSrc ? 'checker' : ''} />
                  <span className={`dot ${it.status}`} title={it.status} />
                  {!busy && <button className="x" onClick={(e) => { e.stopPropagation(); remove(it.id) }}>×</button>}
                </div>
              ))}
              <button className="thumb add" onClick={() => inputRef.current?.click()}>＋</button>
            </div>
          </section>

          <aside>
            <div className="card">
              <h3>1 · Remove background</h3>
              {active && !active.cut && <button className="primary wide" disabled={busy} onClick={() => run([active])}>✨ Remove background</button>}
              {pending.length > 1 && <button className="wide" disabled={busy} onClick={() => run(pending)}>Batch: process all {pending.length}</button>}
              {active?.cut && <p className="ok">✓ Background removed</p>}
              {progress && <div className="bar small"><i style={{ width: `${progress.pct}%` }} /></div>}
            </div>
            <div className="card">
              <h3>2 · Background</h3>
              <div className="swatches">
                <button className={`sw checker ${bg.kind === 'transparent' ? 'on' : ''}`} title="Transparent" onClick={() => setBg({ kind: 'transparent' })} />
                {PRESETS.map((c) => <button key={c} className={`sw ${bg.kind === 'solid' && bg.color === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => setBg({ kind: 'solid', color: c })} />)}
                <label className={`sw picker ${bg.kind === 'solid' && !PRESETS.includes(bg.color) ? 'on' : ''}`} style={{ background: custom }} title="Custom colour">
                  <input type="color" value={custom} onChange={(e) => { setCustom(e.target.value); setBg({ kind: 'solid', color: e.target.value }) }} />🎨
                </label>
              </div>
              <div className="swatches">
                {GRADIENTS.map(([a, b]) => <button key={a + b} className={`sw ${bg.kind === 'gradient' && bg.from === a && bg.to === b ? 'on' : ''}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} onClick={() => setBg({ kind: 'gradient', from: a, to: b, angle: 135 })} />)}
              </div>
              {bg.kind === 'gradient' && <div className="row">
                <input type="color" value={bg.from} onChange={(e) => setBg({ ...bg, from: e.target.value })} />
                <input type="color" value={bg.to} onChange={(e) => setBg({ ...bg, to: e.target.value })} />
                <input type="range" min={0} max={360} value={bg.angle} onChange={(e) => setBg({ ...bg, angle: +e.target.value })} />
              </div>}
            </div>
            <div className="card">
              <h3>3 · Size</h3>
              <div className="sizes">
                {(Object.keys(SIZE_LABELS) as SizePreset[]).map((s) => <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{SIZE_LABELS[s]}</button>)}
              </div>
              {size === 'amazon' && <small>Product is trimmed and centred with padding.</small>}
            </div>
            <div className="card">
              <h3>4 · Download</h3>
              <div className="row">
                <button className="primary" disabled={!active?.cut || busy} onClick={() => active && exportOne(active, 'png')}>PNG{bg.kind === 'transparent' ? ' (transparent)' : ''}</button>
                <button disabled={!active?.cut || busy} onClick={() => active && exportOne(active, 'jpg')}>JPG</button>
              </div>
              {doneCount > 1 && <div className="row">
                <button disabled={busy} onClick={() => exportZip('png')}>ZIP all ({doneCount}) PNG</button>
                <button disabled={busy} onClick={() => exportZip('jpg')}>ZIP JPG</button>
              </div>}
              {bg.kind === 'transparent' && <small>JPG has no transparency; white is used.</small>}
            </div>
          </aside>
        </main>
      )}
      <footer>CutKit · open source (AGPL-3.0) · background removal by <a href="https://github.com/imgly/background-removal-js" target="_blank">@imgly/background-removal</a></footer>
    </div>
  )
}
