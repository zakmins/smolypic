// Downloads the Piper TTS runtime (a native Windows binary) and the two
// French voice models used for card-swipe announcements. Not committed to
// git (see .gitignore) — fetched here instead, the same way better-sqlite3's
// prebuilt binary is fetched via prebuild-install in "postinstall". Safe to
// run repeatedly: every step is skipped if its target already exists.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TTS_DIR = path.join(ROOT, 'electron', 'resources', 'tts');
const PIPER_DIR = path.join(TTS_DIR, 'piper');
const VOICES_DIR = path.join(TTS_DIR, 'voices');

const PIPER_ZIP_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const VOICES = [
  'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx',
  'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx.json',
  'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
  'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json',
];
const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET ${url} -> ${res.statusCode}`));
      }
      const tmp = `${destPath}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, destPath); resolve(); }));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function ensurePiper() {
  const exe = path.join(PIPER_DIR, 'piper.exe');
  if (fs.existsSync(exe)) { console.log('[fetch-tts-assets] piper.exe already present, skipping'); return; }
  fs.mkdirSync(TTS_DIR, { recursive: true });
  const zipPath = path.join(TTS_DIR, 'piper_windows_amd64.zip');
  console.log('[fetch-tts-assets] downloading piper.exe...');
  await download(PIPER_ZIP_URL, zipPath);
  console.log('[fetch-tts-assets] extracting piper.exe...');
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${TTS_DIR}' -Force`]);
  fs.unlinkSync(zipPath);
}

async function ensureVoices() {
  fs.mkdirSync(VOICES_DIR, { recursive: true });
  for (const rel of VOICES) {
    const name = path.basename(rel);
    const dest = path.join(VOICES_DIR, name);
    if (fs.existsSync(dest)) { console.log(`[fetch-tts-assets] ${name} already present, skipping`); continue; }
    console.log(`[fetch-tts-assets] downloading ${name}...`);
    await download(HF_BASE + rel, dest);
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[fetch-tts-assets] not on Windows — skipping (Piper bundle is Windows-only for now)');
    return;
  }
  await ensurePiper();
  await ensureVoices();
  console.log('[fetch-tts-assets] done');
}

main().catch((e) => { console.error('[fetch-tts-assets] failed:', e.message); process.exit(1); });
