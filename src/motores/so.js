'use strict';

/**
 * O que existe instalado na máquina: Office, LibreOffice, Chrome/Edge,
 * Ghostscript. O resto do sistema pergunta aqui em vez de espalhar
 * `if (process.platform)` por todo canto.
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const EH_WINDOWS = process.platform === 'win32';

function existe(c) {
  try { return fs.existsSync(c); } catch (_) { return false; }
}

/** Procura um executável numa lista de lugares conhecidos e depois no PATH. */
function acharPrograma(nomes, candidatos = []) {
  for (const c of candidatos) if (existe(c)) return c;
  const lista = Array.isArray(nomes) ? nomes : [nomes];
  const caminhos = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensoes = EH_WINDOWS ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const nome of lista) {
    for (const dir of caminhos) {
      for (const ext of extensoes) {
        const alvo = path.join(dir, nome + ext);
        if (existe(alvo)) return alvo;
      }
    }
  }
  return null;
}

const cache = {};

function memo(chave, fn) {
  if (!(chave in cache)) cache[chave] = fn();
  return cache[chave];
}

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || '';

function acharLibreOffice() {
  return memo('libre', () => acharPrograma(
    ['soffice', 'libreoffice'],
    EH_WINDOWS
      ? [path.join(PF, 'LibreOffice', 'program', 'soffice.exe'), path.join(PF86, 'LibreOffice', 'program', 'soffice.exe')]
      : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice', '/opt/libreoffice/program/soffice']
  ));
}

/** Edge primeiro no Windows: está em toda máquina com Windows 10/11. */
function acharNavegador() {
  return memo('navegador', () => acharPrograma(
    EH_WINDOWS ? ['msedge', 'chrome'] : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge'],
    EH_WINDOWS
      ? [
        path.join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        LOCAL && path.join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ].filter(Boolean)
      : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium']
  ));
}

function acharGhostscript() {
  return memo('gs', () => {
    const candidatos = [];
    if (EH_WINDOWS) {
      for (const base of [path.join(PF, 'gs'), path.join(PF86, 'gs')]) {
        try {
          for (const versao of fs.readdirSync(base).sort().reverse()) {
            candidatos.push(path.join(base, versao, 'bin', 'gswin64c.exe'), path.join(base, versao, 'bin', 'gswin32c.exe'));
          }
        } catch (_) { /* não instalado */ }
      }
    }
    return acharPrograma(EH_WINDOWS ? ['gswin64c', 'gswin32c'] : ['gs'], candidatos);
  });
}

/* ---------------- abrir arquivos e pastas no sistema ---------------- */

/** Abre o Explorer com o arquivo selecionado (ou a pasta). */
function mostrarNaPasta(caminho) {
  return new Promise((resolve) => {
    if (EH_WINDOWS) {
      const alvo = path.resolve(caminho);
      const args = fs.existsSync(alvo) && fs.statSync(alvo).isFile() ? [`/select,${alvo}`] : [alvo];
      // o explorer devolve código 1 mesmo quando dá certo
      execFile('explorer.exe', args, { windowsHide: false }, () => resolve(true));
    } else {
      const p = spawn('xdg-open', [path.dirname(caminho)], { detached: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.unref();
      resolve(true);
    }
  });
}

/** Abre o arquivo no programa padrão (Leitor de PDF, Word...). */
function abrirArquivo(caminho) {
  return new Promise((resolve) => {
    if (EH_WINDOWS) {
      // explorer abre com o programa padrão sem passar pelo cmd (que se
      // confunde com & e ^ no nome do arquivo)
      execFile('explorer.exe', [path.resolve(caminho)], { windowsHide: false }, () => resolve(true));
    } else {
      const p = spawn('xdg-open', [caminho], { detached: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.unref();
      resolve(true);
    }
  });
}

module.exports = {
  EH_WINDOWS,
  acharPrograma,
  acharLibreOffice,
  acharNavegador,
  acharGhostscript,
  mostrarNaPasta,
  abrirArquivo,
};
