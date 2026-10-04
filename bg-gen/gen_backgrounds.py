"""สร้างรูปพื้นหลังหน้าเว็บ Tanot จาก PROMPTS-backgrounds.md ด้วย Pollinations (gen.pollinations.ai)

ต้องมีคีย์ (ตั้งแต่ปี 2026 ไม่มีคีย์จะได้ HTTP 402 ทุกรูป):
  1. สมัคร/ล็อกอินที่ https://enter.pollinations.ai/keys แล้วสร้าง Secret key (ขึ้นต้นด้วย sk_)
  2. สร้างไฟล์ pollinations_key.txt ไว้โฟลเดอร์เดียวกับสคริปต์ ใส่คีย์บรรทัดเดียว
     (หรือตั้ง environment variable POLLINATIONS_KEY แทนก็ได้)
  ห้ามใส่คีย์ลงในสคริปต์นี้ และห้าม commit ไฟล์คีย์ขึ้น GitHub

ใช้: วางไฟล์นี้กับ PROMPTS-backgrounds.md ในโฟลเดอร์เดียวกัน แล้วรัน  python gen_backgrounds.py
  พื้นหลัง → assets/backgrounds/  (<ชื่อ>-light.jpg และ <ชื่อ>-dark.jpg)
  ไอคอน   → assets/icons/        (<ชื่อ>-1.jpg, -2.jpg, ... ตาม Variants)
ถ้ามี Pillow (pip install pillow) จะสร้าง .webp ขนาดเล็กของพื้นหลังให้ด้วย
รูปไหนไม่ชอบ ลบไฟล์นั้นทิ้งแล้วรันใหม่ สคริปต์จะสร้างเฉพาะไฟล์ที่ไม่มี (ใช้ seed ใหม่ทุกครั้ง)
เปลี่ยนโมเดล: ตั้ง POLLINATIONS_MODEL เช่น black-forest-labs/flux.1-schnell

ทำไอคอนครบชุดจากรูปที่เลือก (ต้องมี Pillow):
  python gen_backgrounds.py --make-icons assets/icons/icon-sunrise-2.jpg
  → assets/icons/app/ : icon-512.png, icon-192.png, icon-maskable-512.png, apple-touch-icon.png (180), favicon-32.png
"""
import os
import re
import time
import random
import sys
import urllib.error
import urllib.parse
import urllib.request

OUT_DIR = "assets/backgrounds"
ICON_DIR = "assets/icons"
PROMPTS_FILE = "PROMPTS-backgrounds.md"
WIDTH, HEIGHT = 1280, 720

# สไตล์เดียวกันทุกรูป ให้ดูเป็นชุดเดียวกัน · พื้นที่ว่างด้านซ้าย/กลางไว้วางเนื้อหา
STYLE_COMMON = (
    "soft minimal illustration, muted colors, subtle and calm, "
    "large empty negative space on the left and center, objects only near the right edge, "
    "no people, no hands, no faces, no text, no letters, no numbers, no logo, no watermark"
)
STYLE_LIGHT = "light airy pastel tones on an off-white background, bright and clean"
STYLE_DARK = "deep dark charcoal and navy tones, low contrast, quiet night mood"
NEGATIVE = (
    "text, letters, words, numbers, watermark, logo, signature, people, person, hands, fingers, face, "
    "busy composition, clutter, high contrast, harsh shadows, oversaturated, blurry, low quality"
)
# ไอคอน: สัญลักษณ์เดียวกลางภาพ เว้นขอบ ~15% (ระบบมือถือตัดมุม/ครอปเป็นวงกลมได้) ย่อเหลือ 32 px ยังต้องดูออก
STYLE_ICON = (
    "app icon, flat vector style, one simple bold symbol centered, symbol fills about 60 percent of the canvas "
    "with generous even margin, solid flat background color filling the whole square edge to edge, "
    "no gradient noise, no border, no frame, no rounded corners, no shadow, no text, no letters, "
    "crisp clean edges, readable when very small, teal and white palette"
)
NEGATIVE_ICON = (
    "text, letters, words, numbers, watermark, logo text, photo, realistic, 3d render, gradient mesh, "
    "multiple symbols, busy details, thin lines, border, frame, mockup, phone, device, shadow"
)
RETRY_CODES = {429, 500, 502, 503, 504}
MAX_RETRIES = 4
WAIT_BETWEEN = 3  # วินาที เว้นระยะระหว่างรูป
API_BASE = "https://gen.pollinations.ai/image/"
MODEL = os.environ.get("POLLINATIONS_MODEL", "tongyi-mai/z-image-turbo").strip()
KEY_FILE = "pollinations_key.txt"


class StopRun(Exception):
    """คีย์ผิดหรือเครดิตหมด — รันต่อไปก็ล้มทุกรูป"""


def load_key():
    key = os.environ.get("POLLINATIONS_KEY", "").strip()
    if not key and os.path.exists(KEY_FILE):
        with open(KEY_FILE, "r", encoding="utf-8-sig") as f:
            key = f.read().strip()
    return key


KEY = load_key()


def read_prompts(path):
    """คืน [(name, prompt, type, variants)] — type = 'background' (ค่าเริ่มต้น) หรือ 'icon'"""
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    out = []
    for block in re.split(r"\n(?=## )", content):
        name = re.search(r"\*\*Filename:\*\*\s*`(.*?)`", block)
        prompt = re.search(r"\*\*Prompt:\*\*\s*(.*?)(?=\n\n|\n---|\Z)", block, re.DOTALL)
        if not name or not prompt:
            continue
        kind = re.search(r"^\*\*Type:\*\*\s*(\w+)", block, re.M)
        variants = re.search(r"^\*\*Variants:\*\*\s*(\d+)", block, re.M)
        out.append((name.group(1).strip(), prompt.group(1).strip(),
                    kind.group(1).lower() if kind else "background",
                    int(variants.group(1)) if variants else 3))
    return out


def build_url(prompt, seed, width=WIDTH, height=HEIGHT, negative=NEGATIVE):
    # API ใหม่ไม่มี negative_prompt → ต่อท้ายเป็นข้อความ "avoid: ..." แทน
    full = f"{prompt}. Avoid: {negative}" if negative else prompt
    q = urllib.parse.urlencode({"model": MODEL, "width": width, "height": height, "seed": seed})
    return API_BASE + urllib.parse.quote(full, safe="") + "?" + q


def download(url, path):
    headers = {"User-Agent": "tanot-bg-gen/2.0", "Authorization": "Bearer " + KEY}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=180) as r:
        ctype = r.headers.get("Content-Type", "")
        data = r.read()
    # บางครั้งบริการตอบเป็นหน้า error แทนรูป — เช็กก่อนบันทึก
    if not ctype.startswith("image/") or len(data) < 10_000:
        raise ValueError(f"not an image (Content-Type: {ctype or '-'}, {len(data)} bytes)")
    with open(path, "wb") as f:
        f.write(data)


def to_webp(jpg_path):
    try:
        from PIL import Image
    except ImportError:
        return None
    webp_path = os.path.splitext(jpg_path)[0] + ".webp"
    with Image.open(jpg_path) as im:
        im = im.convert("RGB")
        im.thumbnail((1280, 720))
        im.save(webp_path, "WEBP", quality=72, method=6)
    return webp_path


def make_icons(src):
    """ไอคอนครบชุดจากรูปจัตุรัสที่เลือก — maskable เว้นขอบเพิ่มด้วยสีพื้นของรูป (มุมซ้ายบน)"""
    try:
        from PIL import Image
    except ImportError:
        print("Pillow is required: pip install pillow")
        return
    if not os.path.exists(src):
        print(f"file not found: {src}")
        return
    out = os.path.join(ICON_DIR, "app")
    os.makedirs(out, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        side = min(im.size)
        left, top = (im.width - side) // 2, (im.height - side) // 2
        im = im.crop((left, top, left + side, top + side))
        bg = im.getpixel((4, 4))
        for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)):
            im.resize((size, size), Image.LANCZOS).save(os.path.join(out, name), optimize=True)
        # maskable: ให้สัญลักษณ์อยู่ในวงกลมปลอดภัย 80% กลางภาพ
        canvas = Image.new("RGB", (512, 512), bg)
        inner = im.resize((410, 410), Image.LANCZOS)
        canvas.paste(inner, (51, 51))
        canvas.save(os.path.join(out, "icon-maskable-512.png"), optimize=True)
    print(f"icons written to {out}: icon-512, icon-192, icon-maskable-512, apple-touch-icon, favicon-32")


def generate(path, prompt, width, height, negative, after=None):
    """สร้าง 1 รูป · คืน True ถ้าสำเร็จ · คีย์ผิด/เครดิตหมด → StopRun"""
    for attempt in range(1, MAX_RETRIES + 1):
        seed = random.randint(1, 2_000_000_000)
        try:
            download(build_url(prompt, seed, width, height, negative), path)
            extra = after(path) if after else None
            print(f"   saved {width}x{height} seed {seed}" + (f" + {os.path.basename(extra)}" if extra else ""))
            return True
        except urllib.error.HTTPError as e:
            try:
                body = e.read(400).decode("utf-8", "replace").replace("\n", " ")
            except Exception:
                body = ""
            if e.code == 401:
                raise StopRun("HTTP 401: key missing or invalid - check pollinations_key.txt (should start with sk_)")
            if e.code == 402:
                raise StopRun(f"HTTP 402: out of pollen (credit) on this key/account. Server: {body[:200]}")
            if e.code in RETRY_CODES and attempt < MAX_RETRIES:
                wait = 10 * attempt
                print(f"   HTTP {e.code}, waiting {wait}s then retry ({attempt}/{MAX_RETRIES})")
                time.sleep(wait)
                continue
            print(f"   failed: HTTP {e.code} {body[:200]}")
            return False
        except Exception as e:
            if attempt < MAX_RETRIES:
                print(f"   {e} - retry ({attempt}/{MAX_RETRIES})")
                time.sleep(10 * attempt)
                continue
            print(f"   failed: {e}")
            return False
    return False


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--make-icons":
        make_icons(sys.argv[2])
        return
    if not os.path.exists(PROMPTS_FILE):
        print(f"{PROMPTS_FILE} not found - put it in the same folder as this script")
        return
    if not KEY:
        print("No API key. Get a Secret key (sk_...) at https://enter.pollinations.ai/keys")
        print(f"then save it in {KEY_FILE} next to this script (one line), and run again.")
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ICON_DIR, exist_ok=True)
    items = read_prompts(PROMPTS_FILE)
    jobs = []  # (ชื่อไฟล์, prompt เต็ม, กว้าง, สูง, negative, หลังบันทึก)
    for name, prompt, kind, variants in items:
        if kind == "icon":
            for n in range(1, variants + 1):
                jobs.append((os.path.join(ICON_DIR, f"{name}-{n}.jpg"), f"{prompt}, {STYLE_ICON}", 1024, 1024, NEGATIVE_ICON, None))
        else:
            for mode in ("light", "dark"):
                style = STYLE_LIGHT if mode == "light" else STYLE_DARK
                jobs.append((os.path.join(OUT_DIR, f"{name}-{mode}.jpg"), f"{prompt}, {STYLE_COMMON}, {style}", WIDTH, HEIGHT, NEGATIVE, to_webp))
    n_bg = sum(1 for j in jobs if j[0].startswith(OUT_DIR))
    print(f"{len(items)} groups = {n_bg} backgrounds + {len(jobs) - n_bg} icons · model {MODEL}")

    ok, skipped, failed = 0, 0, []
    for i, (path, full, w, h, neg, after) in enumerate(jobs, 1):
        label = os.path.basename(path)
        if os.path.exists(path):
            skipped += 1
            print(f"[{i}/{len(jobs)}] exists, skip: {label}")
            continue
        print(f"[{i}/{len(jobs)}] generating: {label}")
        try:
            if generate(path, full, w, h, neg, after):
                ok += 1
            else:
                failed.append(label)
        except StopRun as e:
            print(f"   STOP: {e}")
            failed.append(label)
            break
        time.sleep(WAIT_BETWEEN)  # เว้นระยะตามข้อจำกัดจำนวนครั้ง

    print(f"\nDone: new {ok} | skipped {skipped} | failed {len(failed)}")
    if failed:
        print("Failed (run again to retry):", ", ".join(failed))


if __name__ == "__main__":
    main()
