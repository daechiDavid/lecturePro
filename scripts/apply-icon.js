const path = require('path');
const { rcedit } = require('rcedit');

const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'LecturePro.exe');
const ico = path.join(__dirname, '..', 'assets', 'icon.ico');

rcedit(exe, { icon: ico })
  .then(() => console.log('Icon applied to', exe))
  .catch((e) => { console.error('Failed to apply icon:', e.message); process.exit(1); });
