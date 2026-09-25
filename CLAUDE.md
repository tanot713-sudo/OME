# Project rules

## No explanatory subtitles under headings/titles

Never add a descriptive caption/tagline sentence under a heading, section
title, or card title anywhere on the site (any of the portal or child apps).
A title/label stands alone — no second line explaining what it does or how
to use it.

This applies to patterns like `.section-sub`, `.card-sub`, or any similarly
placed explanatory line, for example:
- ❌ "Authorization" + "จัดการผู้ใช้งาน ตำแหน่ง โครงการ และสิทธิ์การเข้าถึงของระบบ OMA"
- ❌ "ผู้ใช้งานทั้งหมด" + "กำหนดตำแหน่งและโครงการที่ผู้ใช้แต่ละคนเข้าถึงได้"
- ✅ "Authorization" (nothing under it)
- ✅ "ผู้ใช้งานทั้งหมด" (nothing under it)

This is a standing rule for all current and future pages/components, not
just the page it was first raised on. Do not reintroduce this pattern.

## Popups/modals/dropdowns are always white/light theme

Every popup — custom modals (add/edit user, confirm dialogs, etc.) and native
browser form popups (`<datalist>` suggestion lists, `<select>` dropdowns) —
must render with a white/light background, always, regardless of the
device/browser's own dark-mode setting or any dark mode the site adds later.

For native form popups (which the browser renders using the OS/browser color
scheme unless told otherwise), set `color-scheme: light` on `:root` so
`<datalist>`/`<select>` dropdowns can't turn dark on a dark-mode device —
this was the cause of the black project-code autocomplete dropdown on the
Authorization page.

This is a standing rule for all current and future popups, not just the one
first raised on. Do not reintroduce a dark-rendering popup anywhere.

## Loading spinners: bare spinner only, no caption text

Every loading state — the initial page boot, switching between menu tabs,
a child app's own "fetching data" screen — shows a plain spinning ring only.
No text underneath it, ever: not "กำลังโหลด...", "กำลังโหลดข้อมูล...",
"กำลังเริ่มต้นระบบ...", or anything else. This is the same rule as "no
explanatory captions" above, extended explicitly to loading screens.

Every spinner must also be truly centered on the screen/panel it occupies
(a fixed/absolute overlay with flex or grid centering) — not just padded
from the top of an otherwise normal-flow container, which only looks
centered by accident depending on content height.

This is a standing rule for all current and future loading states, not just
the ones first raised on. Do not reintroduce spinner captions or
off-center loading screens.
