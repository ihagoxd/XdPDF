'use strict';

/**
 * MeuPDF como aplicativo de Windows (Electron).
 *
 * O mesmo servidor do MeuPDF roda aqui dentro, sem precisar do Node.js
 * instalado, e a interface abre numa janela própria. Os dados ficam em
 * %APPDATA%\MeuPDF\dados, separados da pasta do programa.
 */

const { app, BrowserWindow, Menu, shell, nativeTheme, session, dialog, screen } = require('electron');
const fs = require('fs');
const net = require('net');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ICONE = path.join(RAIZ, 'public', 'icones', 'meupdf.ico');

app.setAppUserModelId('com.ihagomartins.meupdf');

// Uma janela só: abrir o atalho de novo traz a que já está aberta.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let janela = null;
let urlBase = null;

/* ---------------- porta livre ---------------- */

function portaLivre(porta) {
  return new Promise((resolve) => {
    const teste = net.createServer();
    teste.once('error', () => resolve(false));
    teste.once('listening', () => teste.close(() => resolve(true)));
    teste.listen(porta, '127.0.0.1');
  });
}

/** 3020, 3022, 3024... (a porta seguinte fica para o acesso pelo celular). */
async function escolherPorta() {
  for (let p = 3020; p < 3100; p += 2) {
    if (await portaLivre(p) && await portaLivre(p + 1)) return p;
  }
  return 3020;
}

/* ---------------- tamanho e posição da janela ---------------- */

const arquivoJanela = () => path.join(app.getPath('userData'), 'janela.json');

function lerEstadoJanela() {
  try { return JSON.parse(fs.readFileSync(arquivoJanela(), 'utf8')); } catch (_) { return {}; }
}

function guardarEstadoJanela() {
  if (!janela || janela.isDestroyed() || janela.isMinimized()) return;
  const estado = janela.isMaximized()
    ? { ...lerEstadoJanela(), maximizada: true }
    : { maximizada: false, limites: janela.getBounds() };
  try { fs.writeFileSync(arquivoJanela(), JSON.stringify(estado)); } catch (_) { /* sem problema */ }
}

/** Posição salva só vale se ainda cair dentro de algum monitor. */
function limitesValidos(limites) {
  if (!limites) return null;
  const visivel = screen.getAllDisplays().some(({ workArea: a }) => limites.x < a.x + a.width - 80
    && limites.x + limites.width > a.x + 80 && limites.y >= a.y - 10 && limites.y < a.y + a.height - 80);
  return visivel ? limites : null;
}

/* ---------------- janela ---------------- */

function criarJanela() {
  const salvo = lerEstadoJanela();
  janela = new BrowserWindow({
    width: 1400,
    height: 900,
    ...(limitesValidos(salvo.limites) || {}),
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: 'MeuPDF',
    icon: ICONE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0e12' : '#f3f4f8',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (salvo.maximizada) janela.maximize();

  janela.once('ready-to-show', () => janela.show());
  janela.on('resize', guardarEstadoJanela);
  janela.on('move', guardarEstadoJanela);
  janela.on('close', guardarEstadoJanela);
  janela.on('closed', () => { janela = null; });

  // Links para fora (Instagram, ajuda) abrem no navegador de sempre.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(urlBase)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(urlBase)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  janela.loadURL(urlBase);
}

/* ---------------- downloads: "Salvar como" do Windows ---------------- */

function configurarDownloads() {
  session.defaultSession.on('will-download', (evento, item) => {
    item.setSaveDialogOptions({
      title: 'Salvar arquivo do MeuPDF',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      buttonLabel: 'Salvar',
    });
  });
}

/* ---------------- início ---------------- */

app.on('second-instance', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const porta = await escolherPorta();
  process.env.PORT = String(porta);
  process.env.ABRIR = '0';
  process.env.MEUPDF_LOG = '1';
  process.env.MEUPDF_DADOS = path.join(app.getPath('userData'), 'dados');

  try {
    const { iniciar } = require(path.join(RAIZ, 'src', 'server.js'));
    const r = await iniciar({ abrirJanela: false, modoApp: false, unicaInstancia: false });
    urlBase = r.url;
  } catch (err) {
    dialog.showErrorBox('MeuPDF', `Não foi possível iniciar o MeuPDF.\n\n${err && err.message ? err.message : err}`);
    app.quit();
    return;
  }

  configurarDownloads();
  criarJanela();
});
