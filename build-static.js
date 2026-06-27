// สร้างเวอร์ชัน static (ไม่พึ่ง Apps Script) ของหน้าเว็บลงโฟลเดอร์ docs/ สำหรับ host บน GitHub Pages
// รันใหม่ทุกครั้งที่แก้ index.html / script / styles แล้วต้องการอัปเดตเว็บที่ฝากไว้ข้างนอก
// ใช้งาน:  node build-static.js
const fs = require('fs');

const html0 = fs.readFileSync('index.html', 'utf8');
const style = fs.readFileSync('styles', 'utf8').replace(/^<style>\n?/, '').replace(/<\/style>\s*$/, '');
const script = fs.readFileSync('script', 'utf8').replace(/^<script>\n?/, '').replace(/<\/script>\s*$/, '');

const html = html0
  .replace('<?!= include("styles") ?>', '<link rel="stylesheet" href="styles.css">')
  .replace('<?!= include("script") ?>', '<script src="script.js"></script>');

if (!fs.existsSync('docs')) fs.mkdirSync('docs');
fs.writeFileSync('docs/styles.css', style);
fs.writeFileSync('docs/script.js', script);
fs.writeFileSync('docs/index.html', html);

console.log('✅ สร้าง docs/index.html, docs/styles.css, docs/script.js แล้ว');
console.log('   อย่าลืม commit + push แล้ว GitHub Pages จะอัปเดตให้อัตโนมัติ (ใช้เวลาสักครู่)');
