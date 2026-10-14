'use strict';

/**
 * Conversões pelo LibreOffice — usado no Linux, ou no Windows sem Office.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const so = require('./so');

const execFileAsync = promisify(execFile);

// Perfil próprio: não briga com um LibreOffice aberto pela pessoa.
const PERFIL = path.join(os.tmpdir(), 'xdpdf-libre');

function disponivel() {
  return Boolean(so.acharLibreOffice());
}

function pastaTemporaria() {
  const dir = path.join(os.tmpdir(), `xdpdf-libre-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function rodar(args, timeout) {
  const programa = so.acharLibreOffice();
  if (!programa) throw new Error('LibreOffice não está instalado nesta máquina.');
  const perfil = 'file:///' + PERFIL.replace(/\\/g, '/').replace(/^\/+/, '');
  await execFileAsync(programa, [
    '--headless', '--norestore', '--invisible', '--nolockcheck', '--nodefault', '--nofirststartwizard',
    `-env:UserInstallation=${perfil}`,
    ...args,
  ], { timeout: timeout || 180000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

/**
 * @returns {Promise<{resultado: Map<string,{ok:boolean,saida?:string,erro?:string}>, destino:string}>}
 */
async function converter(origens, filtro, extensao) {
  const resultado = new Map();
  const destino = pastaTemporaria();
  if (!origens.length) return { resultado, destino };
  try {
    await rodar(
      ['--convert-to', filtro, '--outdir', destino, ...origens.map((o) => path.resolve(o))],
      Math.max(180000, origens.length * 45000)
    );
    for (const origem of origens) {
      const base = path.basename(origem, path.extname(origem));
      const alvo = path.join(destino, `${base}.${extensao}`);
      resultado.set(path.resolve(origem), fs.existsSync(alvo) && fs.statSync(alvo).size > 0
        ? { ok: true, saida: alvo }
        : { ok: false, erro: 'O LibreOffice não gerou o arquivo' });
    }
  } catch (err) {
    const msg = err.killed
      ? 'A conversão demorou demais e foi interrompida'
      : `Falha no LibreOffice (${String(err.message || '').split('\n')[0].slice(0, 120)})`;
    for (const o of origens) if (!resultado.has(path.resolve(o))) resultado.set(path.resolve(o), { ok: false, erro: msg });
  }
  return { resultado, destino };
}

function paraPdf(origens) {
  return converter(origens, 'pdf', 'pdf');
}

async function limpar(dir) {
  if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}

module.exports = { disponivel, paraPdf, converter, limpar };
