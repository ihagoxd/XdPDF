'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const config = require('./config');
const armazem = require('./nucleo/armazem');
const eventos = require('./nucleo/eventos');
const janela = require('./nucleo/janela');
const rede = require('./nucleo/rede');
const configuracao = require('./nucleo/configuracao');
require('./ferramentas/todas'); // registra as ferramentas no catálogo
const api = require('./rotas/api');

/* ---------------- registro em arquivo no modo app ---------------- */

// Sem janela de console (modo app ou instalador): o que der errado vai para dados/xdpdf.log.
if ((config.MODO_APP || process.env.XDPDF_LOG === '1') && !process.stdout.isTTY) {
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

// Quem chega pela porta do celular precisa do código de acesso.
app.use(rede.portaria);
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

/**
 * Sobe o servidor.
 * @param {object} [op]
 * @param {boolean} [op.abrirJanela]  abre a janela (Edge em modo app ou o navegador)
 * @param {boolean} [op.modoApp]      encerra quando a última janela fechar
 * @param {boolean} [op.unicaInstancia] se já houver um XdPDF nesta porta, só abre a janela dele
 * @returns {Promise<{url:string, servidor:http.Server}|null>} null quando outra instância assumiu
 */
async function iniciar({ abrirJanela = config.ABRIR_JANELA, modoApp = config.MODO_APP, unicaInstancia = true } = {}) {
  const url = `http://${config.HOST === '0.0.0.0' ? '127.0.0.1' : config.HOST}:${config.PORTA}`;

  // Já tem um XdPDF rodando? Então só abre outra janela dele.
  if (unicaInstancia && await janela.jaRodando(url)) {
    console.log(`  O XdPDF já está aberto em ${url}`);
    if (abrirJanela) await janela.abrir(url);
    setTimeout(() => process.exit(0), 1500);
    return null;
  }

  await armazem.faxina({ inicio: true });
  setInterval(() => armazem.faxina().catch(() => {}), 3600e3).unref();
  require('./motores/office').detectar(); // já deixa a detecção do Office pronta

  const servidor = http.createServer(app);
  // OCR e conversões longas não podem esbarrar em limite de tempo
  servidor.requestTimeout = 0;
  servidor.headersTimeout = 120000;
  servidor.keepAliveTimeout = 65000;

  await new Promise((resolve, reject) => {
    servidor.once('error', (err) => {
      if (err.code === 'EADDRINUSE') console.error(`  A porta ${config.PORTA} já está em uso por outro programa. Use PORT=outra_porta.`);
      else console.error(err);
      reject(err);
    });
    servidor.listen(config.PORTA, config.HOST, resolve);
  });

  console.log('');
  console.log(`  XdPDF ${config.VERSAO} — ferramentas de PDF, tudo no seu computador`);
  console.log(`  Rodando em ${url}`);
  if (config.HOST !== '127.0.0.1') console.log(`  Aceitando conexões da rede (HOST=${config.HOST})`);
  console.log('  Ctrl+C para encerrar.');
  console.log('');

  if (configuracao.ler().acessoRede) await rede.ligar(app);
  if (abrirJanela) await janela.abrir(url, { modoApp });
  if (modoApp) janela.encerrarQuandoFechar(eventos);
  return { url, servidor };
}

// Rede de segurança: um erro solto não pode derrubar o app no meio de um trabalho.
process.on('unhandledRejection', (err) => console.error('[falha não tratada]', err));
process.on('uncaughtException', (err) => console.error('[erro inesperado]', err));

// Rodando direto (node src/server.js): sobe sozinho. Dentro do app (Electron), quem chama é o main.
if (require.main === module) {
  iniciar().catch(() => process.exit(1));
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => process.exit(0));
}

module.exports = { app, iniciar };
