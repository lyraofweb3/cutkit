import { TOOLS, type Tool } from '../lib/types'

const DESC: Record<Tool, string> = {
  cutout: 'Remove any background in seconds',
  refine: 'Perfect edges with erase / restore brush',
  eraser: 'Brush away objects, people or text',
  upscale: 'Enhance resolution 2× or 4×',
  shadow: 'Add realistic soft drop shadows',
  background: 'Colours, gradients, photos or blur',
  product: 'AI studio scenes for products',
  generate: 'Create images from a prompt',
  expand: 'Outpaint beyond the borders',
  tryon: 'Put garments on a model',
  export: 'Batch export in marketplace sizes',
}

export function Home({ onPick, onFiles }: { onPick: (t: Tool) => void; onFiles: (f: FileList | File[], t?: Tool) => void }) {
  return (
    <div className="home fade-in">
      <section className="hero">
        <span className="pill">✨ Free · Private · Runs in your browser</span>
        <h1>The AI photo studio<br /><span className="grad">for everything you sell.</span></h1>
        <p>Remove backgrounds, erase objects, upscale and create product shots — without uploading your photos anywhere.</p>
        <label className="cta">
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = '' }} />
          Upload a photo
        </label>
        <small className="muted">or drop / paste an image anywhere</small>
      </section>

      <section>
        <h2 className="section-title">All tools</h2>
        <div className="tool-grid">
          {TOOLS.map((t, i) => (
            <button key={t.id} className="tool-card" style={{ animationDelay: `${i * 30}ms` }} onClick={() => onPick(t.id)}>
              <span className="tool-icon">{t.icon}</span>
              <span className="tool-name">{t.label}{t.needsKey && <em className="badge">AI · fal</em>}</span>
              <span className="tool-desc">{DESC[t.id]}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
