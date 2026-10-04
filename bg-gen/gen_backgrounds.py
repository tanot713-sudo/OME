"""สร้างรูปพื้นหลังหน้าเว็บ Tanot จาก PROMPTS-backgrounds.md ด้วย Pollinations

ใช้: วางไฟล์นี้กับ PROMPTS-backgrounds.md ในโฟลเดอร์เดียวกัน แล้วรัน  python gen_backgrounds.py
ได้ไฟล์ใน assets/backgrounds/  (<ชื่อ>-light.jpg และ <ชื่อ>-dark.jpg)
ถ้ามี Pillow (pip install pillow) จะสร้าง .webp ขนาดเล็กให้ด้วย
รูปไหนไม่ชอบ ลบไฟล์นั้นทิ้งแล้วรันใหม่ สคริปต์จะสร้างเฉพาะไฟล์ที่ไม่มี (ใช้ seed ใหม่ทุกครั้ง)
"""
import os
import re
import time
import random
import urllib.error
import urllib.parse
import urllib.request

OUT_DIR = "assets/backgrounds"
PROMPTS_FILE = "PROMPTS-backgrounds.md"
WIDTH, HEIGHT = 1600, 900

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
RETRY_CODES = {429, 500, 502, 503, 504}
MAX_RETRIES = 4


def read_prompts(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    pattern = r"\*\*Filename:\*\*\s*`(.*?)`.*?\*\*Prompt:\*\*\s*(.*?)(?=\n##|\Z)"
    return [(name.strip(), prompt.strip()) for name, prompt in re.findall(pattern, content, re.DOTALL)]


def build_url(prompt, seed):
    q = urllib.parse.urlencode({
        "width": WIDTH, "height": HEIGHT, "nologo": "true", "seed": seed,
        "negative_prompt": NEGATIVE,
    })
    return "https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt) + "?" + q


def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "tanot-bg-gen/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        ctype = r.headers.get("Content-Type", "")
        data = r.read()
    # บางครั้งบริการตอบเป็นหน้า error แทนรูป — เช็กก่อนบันทึก
    if not ctype.startswith("image/") or len(data) < 10_000:
        raise ValueError(f"ไม่ใช่รูป (Content-Type: {ctype or '-'}, {len(data)} ไบต์)")
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


def main():
    if not os.path.exists(PROMPTS_FILE):
        print(f"ไม่พบ {PROMPTS_FILE} — วางไฟล์นี้ไว้โฟลเดอร์เดียวกับสคริปต์")
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    items = read_prompts(PROMPTS_FILE)
    jobs = [(name, mode, prompt) for name, prompt in items for mode in ("light", "dark")]
    print(f"เจอ {len(items)} กลุ่ม = {len(jobs)} รูป")

    ok, skipped, failed = 0, 0, []
    for i, (name, mode, prompt) in enumerate(jobs, 1):
        path = os.path.join(OUT_DIR, f"{name}-{mode}.jpg")
        if os.path.exists(path):
            skipped += 1
            print(f"[{i}/{len(jobs)}] มีแล้ว ข้าม: {name}-{mode}.jpg")
            continue
        full = f"{prompt}, {STYLE_COMMON}, {STYLE_LIGHT if mode == 'light' else STYLE_DARK}"
        print(f"[{i}/{len(jobs)}] กำลังสร้าง: {name}-{mode}.jpg")
        for attempt in range(1, MAX_RETRIES + 1):
            seed = random.randint(1, 10_000_000)
            try:
                download(build_url(full, seed), path)
                webp = to_webp(path)
                print(f"   บันทึกแล้ว (seed {seed})" + (f" + {os.path.basename(webp)}" if webp else ""))
                ok += 1
                break
            except urllib.error.HTTPError as e:
                if e.code in RETRY_CODES and attempt < MAX_RETRIES:
                    wait = 5 * attempt
                    print(f"   HTTP {e.code} รอ {wait} วินาทีแล้วลองใหม่ ({attempt}/{MAX_RETRIES})")
                    time.sleep(wait)
                    continue
                print(f"   ล้ม: HTTP {e.code}")
                failed.append(f"{name}-{mode}")
                break
            except Exception as e:
                if attempt < MAX_RETRIES:
                    print(f"   {e} — ลองใหม่ ({attempt}/{MAX_RETRIES})")
                    time.sleep(5 * attempt)
                    continue
                print(f"   ล้ม: {e}")
                failed.append(f"{name}-{mode}")
                break
        time.sleep(2)  # เว้นระยะ กันโดนจำกัดจำนวนครั้ง

    print(f"\nเสร็จ: สร้างใหม่ {ok} · ข้าม {skipped} · ล้ม {len(failed)}")
    if failed:
        print("รูปที่ล้ม (รันสคริปต์ซ้ำเพื่อลองใหม่):", ", ".join(failed))


if __name__ == "__main__":
    main()
