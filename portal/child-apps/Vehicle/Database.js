// ==========================================
// 🗄️ DATABASE HELPERS (อ่าน/เขียน แผ่นงาน)
// ==========================================
//
// แก้ไข: ไฟล์เดิมมีนิยามฟังก์ชันชุดนี้ซ้ำกันสองชุดที่ขัดแย้งกัน (ชุด "v2.0
// cleaned" ถูกวางไว้ใน branch `if (!sheet) { ... }` ของ getDataFromSheet ตัวแรก
// โดยไม่ตั้งใจ พร้อมอักขระ "a" หลุดมาทำให้เกิด syntax แปลกๆ) ทำให้ชุด v2.0 ทั้งหมด
// เป็นโค้ดตายที่ไม่เคยถูกเรียกใช้จริง (ทำงานเฉพาะตอนหาชีตไม่เจอ ซึ่งจะ throw
// "a is not defined" ก่อนถึงโค้ดจริงด้วยซ้ำ) — เก็บเฉพาะชุดที่ทำงานจริงอยู่แล้ว
// ในโปรดักชันไว้ (ไม่เปลี่ยนพฤติกรรมที่ระบบอื่นอาจพึ่งพาอยู่ เช่น รูปแบบ string
// ของวันที่จาก getDisplayValues) แล้วลบโค้ดตายทิ้งทั้งหมด

function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function getDataFromSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    console.warn('Sheet not found: ' + sheetName);
    return [];
  }

  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      let key = header.trim();
      obj[key] = row[index] || "";
    });
    return obj;
  });
}

function addRowToSheet(sheetName, item) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const row = headers.map(header => {
    let val = item[header];
    if (typeof val === 'object' && val !== null) return JSON.stringify(val);
    return val === undefined ? '' : val;
  });

  sheet.appendRow(row);
  return item;
}

function updateRowInSheet(sheetName, id, updatedItem) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const rowIndex = i + 1;
      const newRow = headers.map((header, colIndex) => {
        if (updatedItem.hasOwnProperty(header)) {
           let val = updatedItem[header];
           if (typeof val === 'object' && val !== null) return JSON.stringify(val);
           return val;
        }
        return data[i][colIndex];
      });

      sheet.getRange(rowIndex, 1, 1, headers.length).setValues([newRow]);
      return { success: true };
    }
  }
  return { success: false, error: 'ID not found' };
}

// (เพิ่มให้เผื่อคุณเรียกใช้ในฟังก์ชัน Delete ต่างๆ)
function deleteRowInSheet(sheetName, id) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'ID not found' };
}
