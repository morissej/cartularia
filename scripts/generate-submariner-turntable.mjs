import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const ARTIFACT_DIR = '/Users/jeromemorisseau/.gemini/antigravity/brain/0c44dc3b-a046-45f2-a41a-248a59cbd211';
const FRAMES_DIR = path.join(ARTIFACT_DIR, 'frames');
const OUT_DIR = '/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/public/assets/demo-watches/rolex-submariner';
const DIST_DIR = '/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/dist/assets/demo-watches/rolex-submariner';

const frameFiles = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.jpg')).sort();
console.log(`Found ${frameFiles.length} frames`);

// 1. Copy all individual spin frames to public and dist demo-watches folder
frameFiles.forEach((file, index) => {
  const src = path.join(FRAMES_DIR, file);
  const destName = `spin-${String(index).padStart(2, '0')}.jpg`;
  fs.copyFileSync(src, path.join(OUT_DIR, destName));
  if (fs.existsSync(DIST_DIR)) {
    fs.copyFileSync(src, path.join(DIST_DIR, destName));
  }
});
console.log('Copied all spin frames to public and dist assets.');

// Also copy frame 0 to main.jpg and frame 7 (180deg) to rear.jpg for perfect consistency on the turntable!
fs.copyFileSync(path.join(FRAMES_DIR, 'frame_00_0deg.jpg'), path.join(OUT_DIR, 'main.jpg'));
fs.copyFileSync(path.join(FRAMES_DIR, 'frame_07_180deg.jpg'), path.join(OUT_DIR, 'rear.jpg'));
if (fs.existsSync(DIST_DIR)) {
  fs.copyFileSync(path.join(FRAMES_DIR, 'frame_00_0deg.jpg'), path.join(DIST_DIR, 'main.jpg'));
  fs.copyFileSync(path.join(FRAMES_DIR, 'frame_07_180deg.jpg'), path.join(DIST_DIR, 'rear.jpg'));
}
console.log('Updated main.jpg and rear.jpg with turntable views.');

// 2. Generate smooth multi-frame sequence for video
const framesBase64 = frameFiles.map(file => {
  const buf = fs.readFileSync(path.join(FRAMES_DIR, file));
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
});

const tempDir = path.join(ARTIFACT_DIR, 'scratch', 'chrome_rec_profile');
fs.mkdirSync(tempDir, { recursive: true });

const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #121212; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="c" width="1080" height="1080"></canvas>
<script>
  window.RECORDING_DONE = false;
  window.RECORDED_BLOB_BASE64 = '';
  window.RECORD_ERROR = '';

  const framesData = ${JSON.stringify(framesBase64)};
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  async function loadImages() {
    return Promise.all(framesData.map(src => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    })));
  }

  async function run() {
    try {
      const images = await loadImages();
      const numKeyframes = images.length;
      const fps = 30;
      const durationSeconds = 7.0; // 7 seconds per 360 turn
      const totalFrames = Math.round(fps * durationSeconds);

      const stream = canvas.captureStream(fps);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
      const chunks = [];

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          window.RECORDED_BLOB_BASE64 = reader.result.split(',')[1];
          window.RECORDING_DONE = true;
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        const progress = frameIdx / totalFrames;
        const virtualIdx = progress * numKeyframes;
        const idx1 = Math.floor(virtualIdx) % numKeyframes;
        const idx2 = (idx1 + 1) % numKeyframes;
        const frac = virtualIdx - Math.floor(virtualIdx);

        ctx.fillStyle = '#181818';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.globalAlpha = 1.0;
        ctx.drawImage(images[idx1], 0, 0, canvas.width, canvas.height);

        if (frac > 0.001) {
          ctx.globalAlpha = frac;
          ctx.drawImage(images[idx2], 0, 0, canvas.width, canvas.height);
        }
        ctx.globalAlpha = 1.0;

        await new Promise(r => setTimeout(r, 1000 / fps));
      }

      recorder.stop();
    } catch (e) {
      window.RECORD_ERROR = String(e.stack || e);
    }
  }

  run();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(htmlContent);
});

server.listen(9877, async () => {
  console.log('Server listening on http://localhost:9877');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${tempDir}`,
    '--remote-debugging-port=9223',
    '--autoplay-policy=no-user-gesture-required',
    'http://localhost:9877'
  ]);

  let done = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const resp = await fetch('http://localhost:9223/json');
      const tabs = await resp.json();
      const tab = tabs.find(t => t.url.includes('9877'));
      if (tab && tab.webSocketDebuggerUrl) {
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((resWs) => {
          ws.onopen = () => {
            ws.send(JSON.stringify({
              id: 1,
              method: 'Runtime.evaluate',
              params: { expression: 'JSON.stringify({ done: window.RECORDING_DONE, error: window.RECORD_ERROR, dataLen: window.RECORDED_BLOB_BASE64 ? window.RECORDED_BLOB_BASE64.length : 0, data: window.RECORDING_DONE ? window.RECORDED_BLOB_BASE64 : "" })' }
            }));
          };
          ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.id === 1 && data.result && data.result.result) {
              const resObj = JSON.parse(data.result.result.value || '{}');
              if (resObj.error) {
                console.error('Browser error:', resObj.error);
              }
              if (resObj.done && resObj.data) {
                const buffer = Buffer.from(resObj.data, 'base64');
                console.log(`Video recorded successfully! Size: ${buffer.length} bytes`);

                const artifactVideoPath = path.join(ARTIFACT_DIR, 'submariner_turntable.webm');
                fs.writeFileSync(artifactVideoPath, buffer);
                console.log(`Saved video to ${artifactVideoPath}`);

                const publicVideoPath = path.join(OUT_DIR, 'motion.webm');
                fs.writeFileSync(publicVideoPath, buffer);
                console.log(`Saved video to ${publicVideoPath}`);

                if (fs.existsSync(DIST_DIR)) {
                  fs.writeFileSync(path.join(DIST_DIR, 'motion.webm'), buffer);
                  console.log(`Saved video to dist motion.webm`);
                }

                done = true;
              }
            }
            ws.close();
            resWs();
          };
          ws.onerror = () => resWs();
        });
      }
    } catch {
      // connecting
    }

    if (done) break;
  }

  chrome.kill();
  server.close();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
  console.log('Video generation finished successfully!');
  process.exit(0);
});
