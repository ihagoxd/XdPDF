'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const config = require('./config');
const armazem = require('./nucleo/armazem');
const eventos = require('./nucleo/eventos');
const janela = require('./nucleo/janela');
require('./ferramentas/todas'); // registra as ferramentas no catálogo
const api = require('./rotas/api');

/* ---------------- registro em arquivo no modo app ---------------- */

// No modo app não há janela de console: o que der errado vai para dados/xdpdf.log.
if (config.MODO_APP && !process.stdout.isTTY) {
  const log = fs.createWriteStream(path.join(config.pastas.dados, 'xdpdf.log'), { flags: 'a' });
  const escrever = (nivel) => (...partes) => {
    const linha = partes.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    log.write(`[${new Date().toISOString()}] ${nivel} ${linha}\n`);
  };
  console.log = escrever('INFO');
  console.warn = escrever('AVISO');
  console.error = escrever('ERRO');
}

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '50mb' }));

// Nada de cache nos arquivos do próprio app: uma atualização aparece na hora.
app.use((req, res, next) => {
  if (!req.path.startsWith('/vendor/')) res.set('Cache-Control', 'no-cache');
  next();
});

const nm = (...p) => path.join(config.RAIZ, 'node_modules', ...p);
const estatico = (dir, maxAge = '7d') => express.static(dir, { maxAge, fallthrough: false });

app.use('/vendor/preact', estatico(nm('preact', 'dist')));
app.use('/vendor/preact-hooks', estatico(nm('preact', 'hooks', 'dist')));
app.use('/vendor/htm', estatico(nm('htm', 'dist')));
app.use('/vendor/htm-preact', estatico(nm('htm', 'preact')));
app.use('/vendor/pdfjs', estatico(nm('pdfjs-dist', 'build')));
app.use('/vendor/pdfjs-cmaps', estatico(nm('pdfjs-dist', 'cmaps')));
app.use('/vendor/pdfjs-fontes', estatico(nm('pdfjs-dist', 'standard_fonts')));

app.use(express.static(path.join(config.RAIZ, 'public'), { etag: true, maxAge: 0 }));
app.use('/api', api);

// Aplicativo de página única: qualquer rota volta para o index.
app.get(/^\/(?!api\/|vendor\/).*/, (req, res) => {
  res.sendFile(path.join(config.RAIZ, 'public', 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[erro]', err);
  if (res.headersSent) return res.end();
  res.status(500).type('text/plain').send('Erro inesperado.');
});

/* ---------------- inicialização ---------------- */

async function iniciar() {
  const url = `http://${config.HOST === '0.0.0.0' ? '127.0.0.1' : config.HOST}:${config.PORTA}`;

  // Já tem um XdPDF rodando? Então só abre outra janela dele.
  if (await janela.jaRodando(url)) {
    console.log(`  O XdPDF já está aberto em ${url}`);
    if (config.ABRIR_JANELA) await janela.abrir(url);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  await armazem.faxina({ inicio: true });
  setInterval(() => armazem.faxina().catch(() => {}), 3600e3).unref();
  require('./motores/office').detectar(); // já deixa a detecção do Office pronta

  const servidor = http.createServer(app);
  // OCR e conversões longas não podem esbarrar em limite de tempo
  servidor.requestTimeout = 0;
  servidor.headersTimeout = 120000;
  servidor.keepAliveTimeout = 65000;

  servidor.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`  A porta ${config.PORTA} já está em uso por outro programa. Use PORT=outra_porta.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  servidor.listen(config.PORTA, config.HOST, async () => {
    console.log('');
    console.log(`  XdPDF ${config.VERSAO} — ferramentas de PDF, tudo no seu computador`);
    console.log(`  Rodando em ${url}`);
    if (config.HOST !== '127.0.0.1') console.log(`  Aceitando conexões da rede (HOST=${config.HOST})`);
    console.log('  Ctrl+C para encerrar.');
    console.log('');

    if (config.ABRIR_JANELA) await janela.abrir(url, { modoApp: config.MODO_APP });
    if (config.MODO_APP) janela.encerrarQuandoFechar(eventos);
  });
}

iniciar();

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => process.exit(0));
}

// Rede de segurança: um erro solto não pode derrubar o app no meio de um trabalho.
process.on('unhandledRejection', (err) => console.error('[falha não tratada]', err));
process.on('uncaughtException', (err) => console.error('[erro inesperado]', err));
