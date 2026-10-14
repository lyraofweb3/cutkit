# ✂️ CutKit

A free, Pixelcut-style background remover that runs **100% in your browser** — no server, no uploads, no API keys.

**Live app:** https://lyraofweb3.github.io/cutkit/

## Features
- Upload, drag-and-drop or paste JPG / PNG / WebP images
- AI background removal in the browser (ONNX/WASM, WebGPU when available) with a progress bar
- Before / After / Compare slider views, transparent checkerboard preview
- Replace background: transparent, preset colours (white for marketplace shots), custom colour picker, or gradients (editable colours + angle)
- Download PNG (transparent or with background) or JPG
- Batch mode: add many images, process them in sequence, download all as a ZIP
- Export sizes: Original, Square 1080×1080, Instagram Story 1080×1920, Amazon 2000×2000 (product trimmed and centred with padding)

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173/cutkit/
npm run build    # production build in dist/
```
Deployed to GitHub Pages from the `gh-pages` branch: `npm run deploy` (builds and pushes `dist/`). A ready Actions workflow is in `deploy/github-pages-workflow.yml`; move it to `.github/workflows/` once your token has the `workflow` scope (`gh auth refresh -s workflow`).

## Limits
- The first background removal downloads the AI model (~40–80 MB) from the IMG.LY CDN; after that it's cached by the browser.
- Speed depends on the device: a few seconds per image on a modern laptop, slower on phones.
- GitHub Pages doesn't send cross-origin-isolation headers, so the WASM runtime runs single-threaded (WebGPU used when supported).

## Licence
This project uses [`@imgly/background-removal`](https://github.com/imgly/background-removal-js), which is licensed under **AGPL-3.0**. Because of that, CutKit is also released under AGPL-3.0 and its source is public. Commercial closed-source use needs a commercial licence from IMG.LY (or swapping the model).
