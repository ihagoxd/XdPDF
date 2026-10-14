'use strict';

/**
 * Página da web -> PDF com o Edge/Chrome já instalado, invisível.
 * Conversa com o navegador pelo protocolo de depuração (CDP): assim dá para
 * escolher papel, margens, orientação e esperar a página terminar de carregar.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const config = require('../config');
const so = require('./so');
const { ErroUsuario } = require('../nucleo/util');

const PAPEIS = {
  a4: [8.27, 11.69],
  carta: [8.5, 11],
  oficio: [8.5, 14],
};
const MARGENS = { nenhuma: 0, pequena: 0.25, normal: 0.6 };

/* ---------------- HTML colado: servido uma vez pelo próprio servidor ---------------- */

const paginasColadas = new Map();

function guardarHtml(html) {
  const token = crypto.randomBytes(16).toString('hex');
  const corpo = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${html}</body></html>`;
  paginasColadas.set(token, { corpo, expira: Date.now() + 120000 });
  return `http://127.0.0.1:${config.PORTA}/api/render/${token}`;
}

/** Rota GET /api/render/:token */
function servirHtmlColado(req, res) {
  const item = paginasColadas.get(req.params.token);
  paginasColadas.delete(req.params.token);
  if (!item || item.expira < Date.now()) return res.status(404).end();
  // página isolada: não consegue conversar com o XdPDF nem mandar nada para fora
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts; connect-src 'none'; form-action 'none'");
  res.type('html').send(item.corpo);
}

/* ---------------- conversa com o navegador ---------------- */

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function lerPortaDevtools(perfil, processo, limite = 20000) {
  const arquivo = path.join(perfil, 'DevToolsActivePort');
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    if (processo.exitCode !== null) throw new Error('O navegador fechou ao iniciar.');
    try {
      const [porta, caminho] = (await fsp.readFile(arquivo, 'utf8')).split(/\r?\n/);
      if (porta && caminho) return `ws://127.0.0.1:${porta}${caminho}`;
    } catch (_) { /* ainda não criou */ }
    await esperar(100);
  }
  throw new Error('O navegador não respondeu a tempo.');
}

class Conexao {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pendentes = new Map();
    this.ouvintes = [];
    this.aberta = new Promise((ok, falha) => {
      this.ws.onopen = ok;
      this.ws.onerror = () => falha(new Error('Não deu para conversar com o navegador.'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id && this.pendentes.has(msg.id)) {
        const { ok, falha } = this.pendentes.get(msg.id);
        this.pendentes.delete(msg.id);
        if (msg.error) falha(new Error(msg.error.message));
        else ok(msg.result);
      } else if (msg.method) {
        for (const o of this.ouvintes) o(msg);
      }
    };
  }

  enviar(metodo, params = {}, sessao) {
    this.id += 1;
    const id = this.id;
    return new Promise((ok, falha) => {
      this.pendentes.set(id, { ok, falha });
      this.ws.send(JSON.stringify({ id, method: metodo, params, sessionId: sessao }));
    });
  }

  /** Espera um evento (com limite de tempo). */
  aguardar(teste, ms) {
    return new Promise((ok) => {
      const t = setTimeout(() => { this.ouvintes = this.ouvintes.filter((o) => o !== f); ok(null); }, ms);
      const f = (msg) => {
        if (teste(msg)) {
          clearTimeout(t);
          this.ouvintes = this.ouvintes.filter((o) => o !== f);
          ok(msg);
        }
      };
      this.ouvintes.push(f);
    });
  }

  fechar() {
    try { this.ws.close(); } catch (_) { /* já fechada */ }
  }
}

/**
 * @param {{endereco?:string, html?:string, papel?:string, orientacao?:string, margem?:string, fundo?:boolean}} op
 * @returns {Promise<{bytes:Buffer, titulo:string}>}
 */
async function paraPdf({ endereco = '', html = '', papel = 'a4', orientacao = 'retrato', margem = 'normal', fundo = true } = {}, aoProgredir = () => {}) {
  const navegador = so.acharNavegador();
  if (!navegador) throw new ErroUsuario(so.EH_WINDOWS ? 'Não achei o Microsoft Edge nem o Google Chrome nesta máquina.' : 'Instale o Chromium para usar esta ferramenta.');

  let alvo;
  if (String(html).trim()) {
    alvo = guardarHtml(String(html));
  } else {
    let limpo = String(endereco).trim();
    if (!limpo) throw new ErroUsuario('Digite o endereço da página.');
    if (!/^https?:\/\//i.test(limpo)) limpo = `https://${limpo}`;
    try {
      const u = new URL(limpo);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      alvo = u.toString();
    } catch (_) {
      throw new ErroUsuario('Endereço inválido. Use algo como https://www.exemplo.com.br');
    }
  }

  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'xdpdf-nav-'));
  const processo = spawn(navegador, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${perfil}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-features=Translate',
    ...(so.EH_WINDOWS ? [] : ['--no-sandbox', '--disable-dev-shm-usage']),
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let cdp = null;
  try {
    aoProgredir(10, 'Abrindo o navegador invisível...');
    cdp = new Conexao(await lerPortaDevtools(perfil, processo));
    await cdp.aberta;

    const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
    await cdp.enviar('Page.enable', {}, s);
    await cdp.enviar('Page.setLifecycleEventsEnabled', { enabled: true }, s);
    await cdp.enviar('Emulation.setEmulatedMedia', { media: 'print' }, s).catch(() => {});

    aoProgredir(25, 'Carregando a página...');
    const carregou = cdp.aguardar((m) => m.method === 'Page.loadEventFired' && m.sessionId === s, 45000);
    const navegacao = await cdp.enviar('Page.navigate', { url: alvo }, s);
    if (navegacao.errorText) {
      throw new ErroUsuario(/NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION/i.test(navegacao.errorText)
        ? 'Não consegui abrir a página. Confira o endereço e a conexão com a internet.'
        : `O navegador não abriu a página (${navegacao.errorText}).`);
    }
    if (!(await carregou)) throw new ErroUsuario('A página demorou demais para carregar.');
    aoProgredir(55, 'Esperando imagens e estilos...');
    // espera a rede acalmar (imagens preguiçosas, fontes), com limite
    await cdp.aguardar((m) => m.method === 'Page.lifecycleEvent' && m.sessionId === s && m.params.name === 'networkIdle', 12000);
    // rola até o fim para disparar imagens "lazy" e volta ao topo
    await cdp.enviar('Runtime.evaluate', {
      expression: `(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += innerHeight) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } scrollTo(0, 0); })()`,
      awaitPromise: true,
    }, s).catch(() => {});
    await esperar(600);

    const tituloRes = await cdp.enviar('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, s).catch(() => null);
    const titulo = (tituloRes && tituloRes.result && tituloRes.result.value) || '';

    aoProgredir(75, 'Gerando o PDF...');
    const m = MARGENS[margem] != null ? MARGENS[margem] : MARGENS.normal;
    const params = { printBackground: fundo !== false, marginTop: m, marginBottom: m, marginLeft: m, marginRight: m, preferCSSPageSize: false };
    if (papel === 'unica') {
      await cdp.enviar('Emulation.setEmulatedMedia', { media: 'screen' }, s).catch(() => {});
      const med = await cdp.enviar('Runtime.evaluate', {
        expression: 'JSON.stringify({w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)})',
        returnByValue: true,
      }, s);
      const { w, h } = JSON.parse(med.result.value);
      params.paperWidth = Math.min(Math.max(w / 96 + m * 2, 3), 50);
      params.paperHeight = Math.min(Math.max(h / 96 + m * 2 + 0.2, 3), 200);
    } else {
      const [pw, ph] = PAPEIS[papel] || PAPEIS.a4;
      params.paperWidth = pw;
      params.paperHeight = ph;
      params.landscape = orientacao === 'paisagem';
    }
    const { data } = await cdp.enviar('Page.printToPDF', params, s);
    await cdp.enviar('Browser.close').catch(() => {});
    return { bytes: Buffer.from(data, 'base64'), titulo };
  } finally {
    if (cdp) cdp.fechar();
    setTimeout(() => {
      try { if (processo.exitCode === null) processo.kill(); } catch (_) { /* já saiu */ }
      fs.rm(perfil, { recursive: true, force: true }, () => {});
    }, 800);
  }
}

module.exports = { paraPdf, servirHtmlColado };
