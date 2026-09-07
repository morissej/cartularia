import http from 'http';
import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = '/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/public';
const DIST_DIR = '/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/dist/assets/demo-watches/rolex-submariner';
const ARTIFACT_DIR = '/Users/jeromemorisseau/.gemini/antigravity/brain/0c44dc3b-a046-45f2-a41a-248a59cbd211';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save-video') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { base64 } = JSON.parse(body);
        const buffer = Buffer.from(base64, 'base64');
        
        // 1. Artifact dir
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'submariner_turntable.webm'), buffer);
        
        // 2. Public demo watches dir
        const publicMotion = path.join(PUBLIC_DIR, 'assets/demo-watches/rolex-submariner/motion.webm');
        fs.writeFileSync(publicMotion, buffer);

        // 3. Dist demo watches dir
        if (fs.existsSync(DIST_DIR)) {
          fs.writeFileSync(path.join(DIST_DIR, 'motion.webm'), buffer);
        }

        console.log(`Successfully saved motion.webm (${buffer.length} bytes) to all target locations!`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, bytes: buffer.length }));
      } catch (err) {
        console.error('Error saving video:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  const urlPath = req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'record_turntable.html' : urlPath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(8765, () => {
  console.log('Static & upload server running on http://localhost:8765');
});
