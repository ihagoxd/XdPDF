'use strict';

/**
 * "Usar no celular": abre uma segunda porta, visível na rede Wi-Fi, só
 * enquanto a pessoa quiser. Quem chega por ela precisa do código de acesso
 * (que já vem dentro do QR Code), então ninguém mais da rede entra sem ele.
 */

const os = require('os');
const http = require('http');
const crypto = require('crypto');

const config = require('../config');
const configuracao = require('./configuracao');

let servidor = null;
let erroAoLigar = null;

function porta() {
  return config.PORTA + 1;
}

/** IPs desta máquina na rede local (Wi-Fi/cabo), os mais prováveis primeiro. */
function enderecos() {
  const lista = [];
  for (const [nome, ifs] of Object.entries(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (/^169\.254\./.test(i.address)) continue; // sem DHCP
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback|Bluetooth/i.test(nome);
      const privado = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address);
      lista.push({ endereco: i.address, interface: nome, peso: (privado ? 2 : 0) + (virtual ? -3 : 0) + (/Wi-?Fi|Wireless|WLAN/i.test(nome) ? 1 : 0) });
    }
  }
  return lista.sort((a, b) => b.peso - a.peso).map(({ endereco, interface: nomeInterface }) => ({ endereco, interface: nomeInterface }));
}

function codigoAtual() {
  const cfg = configuracao.ler();
  if (cfg.codigoRede && /^\d{6}$/.test(cfg.codigoRede)) return cfg.codigoRede;
  return novoCodigo();
}

function novoCodigo() {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  configuracao.salvar({ codigoRede: codigo });
  return codigo;
}

/** O valor do cookie depende do código: trocar o código desconecta todo mundo. */
function ficha(codigo) {
  return crypto.createHash('sha256').update(`meupdf:${codigo}:${config.pastas.dados}`).digest('base64url').slice(0, 32);
}

function lerCookie(req, nome) {
  const m = new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------------- tentativas erradas (contra adivinhação) ---------------- */

const tentativas = new Map();

function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.n >= 8 && Date.now() - t.desde < 15 * 60 * 1000;
}

function errou(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde > 15 * 60 * 1000) tentativas.set(ip, { n: 1, desde: Date.now() });
  else t.n += 1;
}

/* ---------------- página de entrada (no celular) ---------------- */

function paginaEntrada(mensagem = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>MeuPDF</title>
<link rel="icon" href="/icones/meupdf.svg"><meta name="theme-color" content="#e8383d">
<style>
  :root { color-scheme: light dark; }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, "Segoe UI", sans-serif; background: #f3f4f8; color: #14161c; padding: 20px; box-sizing: border-box; }
  @media (prefers-color-scheme: dark) { body { background: #0d0e12; color: #eceef3; } .caixa { background: #16181e !important; border-color: #272b35 !important; } input { background: #1b1e25 !important; color: #eceef3; border-color: #363b47 !important; } p { color: #a3a9b7 !important; } }
  .caixa { width: 100%; max-width: 360px; background: #fff; border: 1px solid #e1e4eb; border-radius: 22px; padding: 28px 24px; text-align: center; }
  img { width: 56px; height: 56px; }
  h1 { font-size: 22px; margin: 14px 0 6px; }
  p { color: #535a6a; font-size: 14px; margin: 0 0 18px; line-height: 1.45; }
  input { width: 100%; box-sizing: border-box; height: 54px; font-size: 26px; letter-spacing: 10px; text-align: center; border-radius: 14px; border: 1px solid #cdd2dc; outline: none; }
  input:focus { border-color: #e8383d; }
  button { width: 100%; margin-top: 12px; height: 50px; border: 0; border-radius: 14px; background: #e8383d; color: #fff; font-size: 16px; font-weight: 650; }
  .erro { color: #dc2626; font-size: 13px; margin-top: 10px; }
</style></head><body>
<form class="caixa" method="get" action="/">
  <img src="/icones/meupdf.svg" alt="">
  <h1>MeuPDF</h1>
  <p>Digite o código de 6 números que aparece em <b>Configurações → Usar no celular</b>, no computador. Ou aponte a câmera para o QR Code.</p>
  <input name="acesso" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autofocus required>
  <button type="submit">Entrar</button>
  ${mensagem ? `<div class="erro">${mensagem}</div>` : ''}
</form></body></html>`;
}

/**
 * Middleware: só age em quem chegou pela porta da rede. Quem está no próprio
 * computador (porta normal) passa direto.
 */
function portaria(req, res, next) {
  if (!servidor || req.socket.localPort !== porta()) return next();
  const codigo = codigoAtual();
  const esperado = ficha(codigo);
  if (lerCookie(req, 'meupdf_acesso') === esperado) return next();

  const ip = req.socket.remoteAddress || '';
  // arquivos visuais da tela de entrada
  if (req.method === 'GET' && /^\/icones\//.test(req.path)) return next();

  if (req.query && req.query.acesso !== undefined) {
    if (bloqueado(ip)) return res.status(429).type('html').send(paginaEntrada('Muitas tentativas. Espere 15 minutos.'));
    if (String(req.query.acesso).trim() === codigo) {
      tentativas.delete(ip);
      res.setHeader('Set-Cookie', `meupdf_acesso=${esperado}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax`);
      return res.redirect('/');
    }
    errou(ip);
    return res.status(401).type('html').send(paginaEntrada('Código errado. Confira no computador.'));
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, erro: 'Acesso pelo celular não autorizado. Abra o MeuPDF pelo QR Code de novo.' });
  return res.type('html').send(paginaEntrada());
}

/* ---------------- ligar e desligar ---------------- */

function ligar(app) {
  if (servidor) return Promise.resolve(estado());
  erroAoLigar = null;
  return new Promise((resolve) => {
    const s = http.createServer(app);
    s.requestTimeout = 0;
    s.headersTimeout = 120000;
    s.on('error', (err) => {
      erroAoLigar = err.code === 'EADDRINUSE'
        ? `A porta ${porta()} já está em uso por outro programa.`
        : `Não deu para abrir a rede (${err.code || err.message}).`;
      servidor = null;
      resolve(estado());
    });
    s.listen(porta(), '0.0.0.0', () => {
      servidor = s;
      console.log(`  Acesso pelo celular ligado na porta ${porta()}`);
      resolve(estado());
    });
  });
}

function desligar() {
  return new Promise((resolve) => {
    if (!servidor) { resolve(estado()); return; }
    const s = servidor;
    servidor = null;
    s.close(() => resolve(estado()));
    if (s.closeAllConnections) s.closeAllConnections();
  });
}

function estado() {
  const codigo = codigoAtual();
  const ips = enderecos();
  const url = ips.length ? `http://${ips[0].endereco}:${porta()}/?acesso=${codigo}` : null;
  let qr = null;
  if (servidor && url) {
    const m = require('qrcode-generator');
    const qrcode = m.default || m;
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  return {
    ativo: Boolean(servidor),
    porta: porta(),
    codigo,
    enderecos: ips,
    url,
    qr,
    erro: erroAoLigar,
  };
}

module.exports = { portaria, ligar, desligar, estado, novoCodigo, porta };
