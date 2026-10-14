'use strict';

/**
 * Assinaturas guardadas para reutilizar (PNG com fundo transparente).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');
const { novoId, ErroUsuario } = require('./util');

const DIR = config.pastas.assinaturas;
const ID_VALIDO = /^[A-Za-z0-9_-]{6,40}$/;

function caminho(id) {
  if (!ID_VALIDO.test(String(id))) return null;
  const alvo = path.join(DIR, `${id}.png`);
  return fs.existsSync(alvo) ? alvo : null;
}

async function listar() {
  const nomes = await fsp.readdir(DIR).catch(() => []);
  const itens = [];
  for (const nome of nomes) {
    if (!nome.endsWith('.png')) continue;
    const st = await fsp.stat(path.join(DIR, nome)).catch(() => null);
    if (st) itens.push({ id: nome.replace(/\.png$/, ''), criadoEm: st.mtimeMs });
  }
  return itens.sort((a, b) => b.criadoEm - a.criadoEm);
}

async function guardar(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ErroUsuario('Assinatura inválida.');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > 3 * 1024 * 1024) throw new ErroUsuario('Imagem de assinatura grande demais.');
  const id = novoId();
  await fsp.writeFile(path.join(DIR, `${id}.png`), bytes);
  return { id, criadoEm: Date.now() };
}

async function apagar(id) {
  const alvo = caminho(id);
  if (alvo) await fsp.rm(alvo, { force: true });
}

module.exports = { listar, guardar, apagar, caminho };
