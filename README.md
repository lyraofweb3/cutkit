# ✂️ CutKit

A free, Pixelcut-style **AI photo studio** that runs mostly in your browser — cutouts, refine brush, magic eraser, upscale, shadows and batch export with no uploads. Optional generative tools (product shots, text-to-image, expand, virtual try-on) call [fal.ai](https://fal.ai) with a key you paste in Settings (stored only in `localStorage`).

**Live app (Railway):** RAILWAY_URL  
Mirror (GitHub Pages, single-threaded): https://lyraofweb3.github.io/cutkit/

## Features
- **Landing** with tool grid, dark/light theme, undo/redo, mobile layout
- **Remove background** — `@imgly/background-removal` (ONNX/WASM)
- **Refine brush** — erase / restore mask with size, hardness, zoom & pan
- **Magic Eraser** — LaMa inpainting (Apache-2.0) in-browser
- **Upscale 2× / 4×** — Real-ESRGAN General x4v3 (BSD-3-Clause)
- **Shadow** — soft / hard / float drop shadows
- **Backgrounds** — transparent, colours, gradients, upload a photo, blur original
- **Export** — PNG/JPG, batch ZIP, sizes: Original · 1080² · Story 1080×1920 · Amazon 2000²
- **AI (needs fal key):** Product Shot (`fal-ai/bria/product-shot`), Generate (`fal-ai/flux/schnell`), Edit (`fal-ai/flux-pro/kontext`), Expand (`fal-ai/bria/expand`), Try-On (`fal-ai/flux-pro/v1/vto`)

Video background removal is **not** included (too heavy for a static Pages app).

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173/cutkit/
npm run build
npm start        # serve dist/ with COOP/COEP headers on $PORT (Railway)
npm run deploy   # GitHub Pages mirror (base /cutkit/)
```

## Limits
- First cutout downloads an IMG.LY model (~40–80 MB); Magic Eraser downloads LaMa (~200 MB); Upscale downloads Real-ESRGAN (~5 MB). All are cached by the browser afterwards.
- In-browser tools use single-threaded WASM on GitHub Pages (no cross-origin isolation). Expect a few seconds per image on a laptop; phones are slower. Upscale of very large images can take a while or run out of memory (cap ~36 MP output).
- Generative tools need your own [fal.ai key](https://fal.ai/dashboard/keys); usage is billed to your fal account. CutKit never stores the key on a server.

## Licences
- App code: AGPL-3.0 (because `@imgly/background-removal` is AGPL-3.0)
- LaMa ONNX (`Carve/LaMa-ONNX`): Apache-2.0
- Real-ESRGAN General x4v3 ONNX (`CoderViking/realesr-general-x4v3-onnx`): BSD-3-Clause
- fal models: see each model card (Bria = licensed training data; FLUX.1 schnell = Apache-2.0; FLUX pro / VTO = commercial API terms)
