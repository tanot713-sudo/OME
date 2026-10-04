# พื้นหลังหน้าเว็บ Tanot

ทุก prompt ต่อท้ายด้วย STYLE_LIGHT หรือ STYLE_DARK อัตโนมัติจากสคริปต์ (ไม่ต้องพิมพ์ซ้ำ)
แต่ละกลุ่มจะได้ 2 ไฟล์: `<ชื่อ>-light.jpg` และ `<ชื่อ>-dark.jpg`

## today
**Filename:** `today`
**Pages:** index (วันนี้)
**Prompt:** calm morning workspace seen from above, a cup of coffee, a small plant and a notebook placed near the right edge, soft window light

## documents
**Filename:** `documents`
**Pages:** word, excel, slides, extract-text, doc-check, doc-check-file, compare
**Prompt:** neat stacks of blank paper sheets, folders and a fountain pen arranged along the right side, clean office desk surface

## engineering
**Filename:** `engineering`
**Pages:** cad, electrical, maintenance, run (est-cost)
**Prompt:** electrical substation equipment silhouettes, transformers and insulators, thin blueprint grid lines, technical drawing atmosphere

## report
**Filename:** `report`
**Pages:** report-dashboard
**Prompt:** abstract soft data visualization shapes, gentle bar and line chart forms fading into the background, very subtle

## law
**Filename:** `law`
**Pages:** legal, classroom-law
**Prompt:** classic scales of justice and a row of thick law books on a wooden shelf near the right edge, quiet library mood

## money
**Filename:** `money`
**Pages:** budget, tax, insurance, receipts
**Prompt:** still life of small neat stacks of coins, a folded paper receipt and a calculator lying untouched on the right side of an empty clean desk, nobody in the scene

## invest
**Filename:** `invest`
**Pages:** invest, invest-stock, invest-fund, invest-gold, invest-bitcoin, invest-gov-bond, invest-lottery, invest-trade-journal, invest-news, invest-business
**Prompt:** abstract upward trending market line climbing from the lower left to the upper right, growth chart going up, small gold bars and a few coins in the lower right corner

## health
**Filename:** `health`
**Pages:** health
**Prompt:** fresh green leaves, an apple and a glass of water with a soft heartbeat line drawn across the background

## car
**Filename:** `car`
**Pages:** car
**Prompt:** quiet empty countryside road curving into the distance, road markings, soft morning haze, no vehicles

## education
**Filename:** `education`
**Pages:** review, classroom-business, classroom-engineering, books, languages
**Prompt:** still life of open notebooks, index cards and a pencil lying untouched near the right edge of an empty cozy study desk, warm lamp light, nobody in the scene

## music
**Filename:** `music`
**Pages:** music
**Prompt:** acoustic guitar and piano keys partially visible at the right edge, a few loose sheet music pages, soft stage light

## sports
**Filename:** `sports`
**Pages:** sports
**Prompt:** empty running track lanes and white field lines seen from above, a football and badminton shuttlecock resting near the right edge

## cooking
**Filename:** `cooking`
**Pages:** cooking
**Prompt:** flat lay of fresh Thai cooking ingredients, chili, garlic, lemongrass, basil leaves and a mortar arranged along the right side of a wooden board

## coding
**Filename:** `coding`
**Pages:** coding, typing
**Prompt:** mechanical keyboard and a coffee mug at the right edge of a dark desk, faint abstract code-like glowing lines in the background, no readable characters

## settings
**Filename:** `settings`
**Pages:** notifications, data, credits, area, soon
**Prompt:** minimal abstract soft geometric shapes, gentle overlapping circles and rounded rectangles, calm and quiet

---

# ไอคอนแอป (คอม + มือถือ)

กลุ่มที่มี `**Type:** icon` สคริปต์จะสร้างภาพจัตุรัส 1024×1024 ตามจำนวน `Variants` (ไม่แยกสว่าง/มืด) ไว้ใน `assets/icons/`
เลือกรูปที่ชอบแล้วรัน `python gen_backgrounds.py --make-icons assets/icons/<ไฟล์ที่เลือก>` จะได้ไอคอนครบทุกขนาดที่เว็บต้องใช้

## icon-areas
**Filename:** `icon-areas`
**Type:** icon
**Variants:** 3
**Prompt:** four soft rounded shapes arranged in a 2 by 2 grid forming one balanced emblem, each shape a slightly different shade of teal, representing four areas of life

## icon-sunrise
**Filename:** `icon-sunrise`
**Type:** icon
**Variants:** 3
**Prompt:** simple sun rising over a single smooth horizon line, geometric and minimal, warm sun on a deep teal background

## icon-leaf
**Filename:** `icon-leaf`
**Type:** icon
**Variants:** 3
**Prompt:** single stylized leaf combined with a small upward arrow, clean geometric mark, white symbol on a solid teal background
