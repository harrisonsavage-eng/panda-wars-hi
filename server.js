const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.xml':  'application/xml',
  '.txt':  'text/plain',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  // Route requests
  let filePath;
  if (req.url === '/' || req.url === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (req.url === '/sitemap.xml') {
    filePath = path.join(__dirname, 'sitemap.xml');
  } else if (req.url === '/robots.txt') {
    filePath = path.join(__dirname, 'robots.txt');
  } else {
    res.writeHead(404); res.end('Not found'); return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Panda Wars running on port ' + PORT);
});
