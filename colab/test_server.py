import io, os, subprocess
os.environ.update(CUTKIT_TOKEN="t0k", CUTKIT_MOCK="1")
from fastapi.testclient import TestClient
from PIL import Image
import server
c = TestClient(server.app)
O = "https://cutkit-production-c14f.up.railway.app"
H = {"X-CutKit-Token": "t0k", "Origin": O}
img = io.BytesIO(); Image.new("RGB", (32, 24), (200, 10, 10)).save(img, "PNG")
r = c.get("/health", headers={"Origin": O}); assert r.json()["ok"] and r.headers["access-control-allow-origin"] == O; print("health", r.json())
r = c.options("/upscale", headers={"Origin": O, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-cutkit-token"}); assert r.status_code == 200; print("preflight ok")
r = c.options("/upscale", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}); assert r.status_code == 400; print("evil origin rejected")
assert c.post("/upscale", files={"file": ("a.png", img.getvalue())}).status_code == 401
assert c.post("/upscale", headers={"X-CutKit-Token": "bad"}, files={"file": ("a.png", img.getvalue())}).status_code == 401; print("auth 401 ok")
for s, w in ((4, 128), (2, 64)):
    r = c.post("/upscale", headers=H, data={"scale": s}, files={"file": ("a.png", img.getvalue())}); assert Image.open(io.BytesIO(r.content)).width == w
print("upscale ok")
r = c.post("/generate", headers=H, data={"prompt": "cat", "width": 512, "height": 320}); assert Image.open(io.BytesIO(r.content)).size == (512, 320); print("generate ok")
subprocess.run("ffmpeg -y -v error -f lavfi -i testsrc=size=160x120:rate=10 -f lavfi -i sine=d=2 -t 2 -pix_fmt yuv420p /tmp/v.mp4", shell=True, check=True)
for bg, mt in (("transparent", "video/webm"), ("#00ff00", "video/mp4")):
    r = c.post("/video/remove-bg", headers=H, data={"background": bg}, files={"file": ("v.mp4", open("/tmp/v.mp4", "rb").read())})
    assert r.status_code == 200 and r.headers["content-type"] == mt, (r.status_code, r.text[:200])
    open("/tmp/out" + mt[-4:].replace("/", "."), "wb").write(r.content)
    print("video", bg, len(r.content), "bytes frames", r.headers["x-cutkit-frames"])
print(subprocess.run("ffprobe -v error -show_entries stream=codec_name,pix_fmt:stream_tags=alpha_mode -of csv=p=0 /tmp/out.webm", shell=True, capture_output=True, text=True).stdout)
print("ALL PASS")
