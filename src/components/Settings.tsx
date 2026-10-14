import { useState } from 'react'
import { getFalKey, setFalKey } from '../lib/fal'

export function Settings({ onClose, theme, setTheme }: { onClose: () => void; theme: string; setTheme: (t: 'dark' | 'light') => void }) {
  const [key, setKey] = useState(getFalKey())
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
