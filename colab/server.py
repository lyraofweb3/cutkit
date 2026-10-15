"""CutKit GPU backend (FastAPI). Run inside the CutKit_GPU.ipynb Colab notebook.

Env:
  CUTKIT_TOKEN   required access token (header: X-CutKit-Token)
  CUTKIT_ORIGINS comma-separated CORS origins
  CUTKIT_MOCK=1  tiny CPU fakes instead of real models (for local tests)
"""
import io, os, shutil, subprocess, tempfile, threading, time
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image
import numpy as np

TOKEN = os.environ.get("CUTKIT_TOKEN", "")
MOCK = os.environ.get("CUTKIT_MOCK") == "1"
ORIGINS = [o.strip() for o in os.environ.get(
    "CUTKIT_ORIGINS",
    "https://cutkit-production-c14f.up.railway.app,https://lyraofweb3.github.io,http://localhost:5173,http://localhost:4173",
).split(",") if o.strip()]
MAX_VIDEO_SECONDS = float(os.environ.get("CUTKIT_MAX_VIDEO_SECONDS", "60"))

app = FastAPI(title="CutKit GPU")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["X-CutKit-Frames"])
_lock = threading.Lock()  # one GPU job at a time

def auth(x_cutkit_token: str = Header(default="")):
    if not TOKEN or x_cutkit_token != TOKEN:
        raise HTTPException(401, "Invalid or missing X-CutKit-Token")

# ---------------- models (lazy) ----------------
_models = {}
def device():
    if MOCK: return "cpu"
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"

def birefnet():
    if "seg" not in _models:
        if MOCK:
            _models["seg"] = lambda im: Image.fromarray(
                (np.array(im.convert("L")) > 127).astype(np.uint8) * 255)
        else:
            import torch
            from torchvision import transforms
            from transformers import AutoModelForImageSegmentation
            m = AutoModelForImageSegmentation.from_pretrained(
                "ZhengPeng7/BiRefNet", trust_remote_code=True).to(device()).eval().half()
            tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(),
                                     transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
            @torch.no_grad()
            def run(im):
                x = tf(im.convert("RGB")).unsqueeze(0).to(device()).half()
                p = m(x)[-1].sigmoid()[0, 0].float().cpu().numpy()
                return Image.fromarray((p * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
            _models["seg"] = run
    return _models["seg"]

ESRGAN_URL = "https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx"
def esrgan():
    if "sr" not in _models:
        if MOCK:
            _models["sr"] = lambda im: im.resize((im.width * 4, im.height * 4), Image.BICUBIC)
        else:
            import onnxruntime as ort, urllib.request
            path = "/content/realesr-general-x4v3.onnx" if os.path.isdir("/content") else "realesr.onnx"
            if not os.path.exists(path): urllib.request.urlretrieve(ESRGAN_URL, path)
            s = ort.InferenceSession(path, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            def run(im, tile=256):
                a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
                H, W = a.shape[:2]; out = np.zeros((H * 4, W * 4, 3), np.float32); pad = 10
                for y in range(0, H, tile):
                    for x in range(0, W, tile):
                        y0, x0 = max(0, y - pad), max(0, x - pad)
                        y1, x1 = min(H, y + tile + pad), min(W, x + tile + pad)
                        r = s.run(None, {"input": a[y0:y1, x0:x1].transpose(2, 0, 1)[None]})[0][0].transpose(1, 2, 0)
                        ty, tx = (y - y0) * 4, (x - x0) * 4
                        h, w = min(tile, H - y) * 4, min(tile, W - x) * 4
                        out[y * 4:y * 4 + h, x * 4:x * 4 + w] = r[ty:ty + h, tx:tx + w]
                return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
            _models["sr"] = run
    return _models["sr"]

GEN_MODEL = os.environ.get("CUTKIT_GEN_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")
def generator():
    if "gen" not in _models:
        if MOCK:
            _models["gen"] = lambda prompt, w, h, steps, seed: Image.new("RGB", (w, h), (120, 80, 200))
        else:
            import torch
            from diffusers import DiffusionPipeline, LCMScheduler
            pipe = DiffusionPipeline.from_pretrained(GEN_MODEL, torch_dtype=torch.float16, variant="fp16").to("cuda")
            pipe.load_lora_weights("latent-consistency/lcm-lora-sdxl"); pipe.fuse_lora()
            pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
            def run(prompt, w, h, steps, seed):
                g = torch.Generator("cuda").manual_seed(seed)
                return pipe(prompt, width=w, height=h, num_inference_steps=steps, guidance_scale=1.0, generator=g).images[0]
            _models["gen"] = run
    return _models["gen"]

def png(im, fmt="PNG"):
    b = io.BytesIO(); im.save(b, fmt); return b.getvalue()

# ---------------- endpoints ----------------
@app.get("/health")
def health():
    info = {"ok": True, "mock": MOCK, "loaded": sorted(_models), "busy": _lock.locked()}
    if not MOCK:
        try:
            import torch
            info["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        except Exception: info["gpu"] = None
    return info

@app.post("/upscale", dependencies=[Depends(auth)])
async def upscale(file: UploadFile = File(...), scale: int = Form(4)):
    if scale not in (2, 4): raise HTTPException(400, "scale must be 2 or 4")
    im = Image.open(io.BytesIO(await file.read()))
    alpha = im.getchannel("A") if im.mode in ("RGBA", "LA") else None
    if im.width * im.height * scale * scale > 64e6: raise HTTPException(413, "Output too large (>64 MP)")
    with _lock:
        out = esrgan()(im.convert("RGB"))
    if scale == 2: out = out.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    if alpha is not None: out.putalpha(alpha.resize(out.size, Image.BILINEAR))
    return Response(png(out), media_type="image/png")

@app.post("/generate", dependencies=[Depends(auth)])
async def generate(prompt: str = Form(...), width: int = Form(1024), height: int = Form(1024),
                   steps: int = Form(4), seed: int = Form(-1)):
    if not prompt.strip(): raise HTTPException(400, "prompt required")
    width, height = max(256, min(1536, width // 8 * 8)), max(256, min(1536, height // 8 * 8))
    seed = seed if seed >= 0 else int(time.time()) % 2**31
    with _lock:
        im = generator()(prompt, width, height, max(1, min(12, steps)), seed)
    return Response(png(im), media_type="image/png")

@app.post("/remove-bg", dependencies=[Depends(auth)])
async def remove_bg(file: UploadFile = File(...)):
    im = Image.open(io.BytesIO(await file.read())).convert("RGB")
    with _lock: m = birefnet()(im)
    im.putalpha(m); return Response(png(im), media_type="image/png")

def _ffprobe_duration(p):
    try:
        return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                              "-of", "csv=p=0", p]).strip())
    except Exception: return 0.0

@app.post("/video/remove-bg", dependencies=[Depends(auth)])
async def video_remove_bg(file: UploadFile = File(...), background: str = Form("transparent"),
                          fps: int = Form(0), max_side: int = Form(1280)):
    """background: 'transparent' -> WebM (VP9 + alpha); '#rrggbb' -> MP4 (H.264) on that colour."""
    work = tempfile.mkdtemp(prefix="cutkit_")
    try:
        src = os.path.join(work, "in" + (os.path.splitext(file.filename or "")[1] or ".mp4"))
        with open(src, "wb") as f: shutil.copyfileobj(file.file, f)
        dur = _ffprobe_duration(src)
        if dur > MAX_VIDEO_SECONDS: raise HTTPException(413, f"Video is {dur:.0f}s; limit is {MAX_VIDEO_SECONDS:.0f}s")
        fr = os.path.join(work, "f"); os.makedirs(fr)
        vf = f"scale='if(gt(iw,ih),min({max_side},iw),-2)':'if(gt(iw,ih),-2,min({max_side},ih))'"
        if fps: vf += f",fps={fps}"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf, os.path.join(fr, "%06d.png")], check=True)
        frames = sorted(os.listdir(fr))
        if not frames: raise HTTPException(400, "No frames decoded")
        rate = fps or (subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                       "stream=r_frame_rate", "-of", "csv=p=0", src]).decode().strip() or "25")
        seg = birefnet()
        bg = None if background == "transparent" else tuple(int(background.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        with _lock:
            for n in frames:
                p = os.path.join(fr, n); im = Image.open(p).convert("RGB"); m = seg(im)
                if bg is None: im.putalpha(m); im.save(p)
                else: Image.composite(im, Image.new("RGB", im.size, bg), m).save(p)
        has_audio = b"audio" in subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
                                                "-of", "csv=p=0", src], capture_output=True).stdout
        audio = ["-i", src, "-map", "0:v", "-map", "1:a?", "-shortest"] if has_audio else []
        if bg is None:
            out, media = os.path.join(work, "out.webm"), "video/webm"
            cmd = ["ffmpeg", "-y", "-v", "error", "-framerate", str(rate), "-i", os.path.join(fr, "%06d.png"), *audio,
                   "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "realtime"]
            if has_audio: cmd += ["-c:a", "libopus"]
        else:
            out, media = os.path.join(work, "out.mp4"), "video/mp4"
            cmd = ["ffmpeg", "-y", "-v", "error", "-framerate", str(rate), "-i", os.path.join(fr, "%06d.png"), *audio,
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart"]
            if has_audio: cmd += ["-c:a", "aac"]
        subprocess.run(cmd + [out], check=True)
        data = open(out, "rb").read()
        return Response(data, media_type=media, headers={"X-CutKit-Frames": str(len(frames))})
    finally:
        shutil.rmtree(work, ignore_errors=True)
