'use strict';

/**
 * A "cara de app": abre o XdPDF numa janela própria do Edge/Chrome, sem barra
 * de endereço nem abas, com ícone próprio na barra de tarefas. Quando a janela
 * fecha, o servidor encerra sozinho (só no modo app).
 */

const { spawn, exec } = require('child_process');
const config = require('../config');
const so = require('../motores/so');

async function jaRodando(url) {
  try {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), 1500);
    const r = await fetch(`${url}/api/sistema`, { signal: controle.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const d = await r.json();
    return Boolean(d && d.versao);
  } catch (_) {
    return false;
  }
}

function abrirNoNavegadorPadrao(url) {
  if (so.EH_WINDOWS) exec(`start "" "${url}"`, { shell: 'cmd.exe', windowsHide: true }, () => {});
  else exec(`xdg-open "${url}"`, () => {});
}

/**
 * @param {string} url
 * @param {{modoApp?: boolean}} opcoes
 */
async function abrir(url, { modoApp = config.MODO_APP } = {}) {
  const navegador = so.acharNavegador();
  if (!modoApp || !navegador) {
    abrirNoNavegadorPadrao(url);
    return;
  }
  const args = [
    `--app=${url}`,
    // perfil próprio: a janela do XdPDF não se mistura com o navegador da pessoa
    `--user-data-dir=${config.pastas.navegador}`,
    '--window-size=1400,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,msEdgeSidebarV2,msHubApps,msEdgeShopping',
    '--disable-sync',
  ];
  try {
    const p = spawn(navegador, args, { detached: true, stdio: 'ignore', windowsHide: false });
    p.on('error', () => abrirNoNavegadorPadrao(url));
    p.unref();
  } catch (_) {
    abrirNoNavegadorPadrao(url);
  }
}

/**
 * Encerra o servidor quando não houver mais nenhuma janela conectada.
 * Espera um pouco antes: recarregar a página derruba e refaz a conexão.
 */
function encerrarQuandoFechar(eventos) {
  let timer = null;
  const ESPERA_FECHOU = 15000;
  const ESPERA_INICIO = 120000;

  const agendar = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (eventos.quantos() === 0) {
        console.log('  Janela fechada. Encerrando o XdPDF.');
        process.exit(0);
      }
    }, ms);
  };

  agendar(ESPERA_INICIO); // se a janela nunca chegar a abrir
  eventos.aoMudarClientes((n) => {
    if (n === 0) agendar(ESPERA_FECHOU);
    else clearTimeout(timer);
  });
}

module.exports = { jaRodando, abrir, encerrarQuandoFechar };
