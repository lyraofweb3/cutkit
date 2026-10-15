import { useState } from 'react'
import { getFalKey, setFalKey } from '../lib/fal'
import { COLAB_NOTEBOOK, getColab, setColab, type ColabStatus } from '../lib/colab'

export function Settings({ onClose, theme, setTheme, colab, recheck }: { onClose: () => void; theme: string; setTheme: (t: 'dark' | 'light') => void; colab: ColabStatus; recheck: () => void }) {
  const [key, setKey] = useState(getFalKey())
  const [cUrl, setCUrl] = useState(getColab().url)
  const [cTok, setCTok] = useState(getColab().token)
  const [saved, setSaved] = useState(false)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Settings</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        <label className="field">
          <span>Theme</span>
          <div className="seg">
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>🌙 Dark</button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>☀️ Light</button>
          </div>
        </label>
        <div className="field">
          <span>Colab GPU <StatusPill s={colab} /></span>
          <input type="text" data-testid="colab-url" placeholder="https://xxxx.trycloudflare.com" value={cUrl} onChange={(e) => setCUrl(e.target.value)} />
          <input type="password" data-testid="colab-token" placeholder="Access token printed by the notebook" value={cTok} onChange={(e) => setCTok(e.target.value)} />
          <div className="row">
            <button className="btn primary" data-testid="colab-save" onClick={() => { setColab(cUrl, cTok); recheck() }}>Save &amp; test</button>
            <a className="btn" href={COLAB_NOTEBOOK} target="_blank" rel="noreferrer"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open in Colab" /></a>
          </div>
          <small className="muted">Free T4 GPU for video background removal, faster upscale and image generation. Run the notebook, then paste its URL + token. Stored only in this browser.</small>
        </div>
        <label className="field">
          <span>fal.ai API key <small className="muted">(for AI generative tools)</small></span>
          <input type="password" placeholder="fal key, e.g. xxxxxxxx:xxxxxxxx" value={key} onChange={(e) => { setKey(e.target.value); setSaved(false) }} />
        </label>
        <p className="muted small">Your key is stored only in this browser (localStorage) and sent directly to fal.ai. Get one at <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">fal.ai/dashboard/keys</a>. Usage is billed to your fal account.</p>
        <div className="row">
          <button className="btn primary" onClick={() => { setFalKey(key); setSaved(true) }}>Save key</button>
          {key && <button className="btn" onClick={() => { setFalKey(''); setKey(''); setSaved(true) }}>Remove</button>}
          {saved && <span className="ok">Saved ✓</span>}
        </div>
      </div>
    </div>
  )
}

export function StatusPill({ s }: { s: ColabStatus }) {
  const label = { unset: 'Not connected', checking: 'Checking…', online: `Online${s.gpu ? ` · ${s.gpu}` : ''}`, offline: 'Offline' }[s.state]
  return <em className={`status ${s.state}`} data-testid="colab-status" title={s.error}>{label}</em>
}
