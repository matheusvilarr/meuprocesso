// Servidor local para testar as TELAS sem precisar do vercel dev.
//
// Por que existe: nesta máquina o Node está instalado só como componente de
// outro programa, sem npm/npx, então `npx vercel dev` não roda. Isto cobre o
// que dá para cobrir sem ele: páginas, login (inclusive Google) e tudo que
// fala direto com o Supabase.
//
// O que NÃO funciona aqui: as rotas /api/* (busca no DataJud, upload, crons).
// Elas respondem 501 com um aviso claro em vez de erro silencioso.
//
// Uso:  node scripts/servidor-local.mjs [porta]

import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.argv[2]) || 3002;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  let rel = decodeURIComponent(url.pathname);

  if (rel.startsWith('/api/')) {
    res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      erro: 'As rotas /api só rodam na Vercel (precisam do vercel dev). ' +
            'Tudo que fala direto com o Supabase — login, cadastro, processos — funciona normalmente aqui.',
    }));
    return;
  }

  if (rel === '/') rel = '/index.html';
  let arquivo = path.join(RAIZ, rel);
  // /blog/ e afins: pasta serve o index.html de dentro dela
  if (rel.endsWith('/')) arquivo = path.join(arquivo, 'index.html');
  // cleanUrls do vercel.json: /dashboard serve dashboard.html
  else if (!path.extname(arquivo)) arquivo += '.html';

  // Não deixa sair da pasta do projeto (../../etc/passwd e afins)
  if (!arquivo.startsWith(RAIZ)) { res.writeHead(403).end('Fora do projeto'); return; }

  fs.readFile(arquivo, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404</h1><p>Não achei <code>${rel}</code></p>`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(buf);
  });
});

servidor.listen(PORTA, () => {
  console.log(`\n  Meu Processo rodando em  http://localhost:${PORTA}`);
  console.log(`  Login:                   http://localhost:${PORTA}/login`);
  console.log(`\n  (as rotas /api não funcionam aqui — precisam do vercel dev)\n`);
});
