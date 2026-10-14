'use strict';

const crypto = require('crypto');
const path = require('path');

function novoId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Tira o que o Windows não aceita em nome de arquivo e encurta nomes enormes. */
function nomeSeguro(nome, reserva = 'arquivo') {
  const limpo = String(nome == null ? '' : nome)
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
  if (!limpo) return reserva;
  if (limpo.length <= 150) return limpo;
  const ext = path.extname(limpo);
  return limpo.slice(0, 150 - ext.length).trim() + ext;
}

function semExtensao(nome) {
  return String(nome).replace(/\.[^./\\]+$/, '');
}

function extensao(nome) {
  return path.extname(String(nome)).toLowerCase();
}

/** Nomes com acento chegam em latin1 do busboy; reinterpreta como UTF-8 quando válido. */
function corrigirNomeUpload(nome) {
  try {
    const bytes = Buffer.from(nome, 'latin1');
    const utf8 = bytes.toString('utf8');
    return Buffer.from(utf8, 'utf8').equals(bytes) ? utf8 : nome;
  } catch (_) {
    return nome;
  }
}

function limitar(valor, min, max, padrao) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
}

function booleano(valor, padrao = false) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  if (typeof valor === 'boolean') return valor;
  return ['1', 'true', 'sim', 'on', 'yes'].includes(String(valor).toLowerCase());
}

/** Erro com mensagem pensada para aparecer na tela. */
class ErroUsuario extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroUsuario';
    this.usuario = true;
  }
}

class Cancelado extends Error {
  constructor() {
    super('Operação cancelada.');
    this.name = 'Cancelado';
    this.cancelado = true;
  }
}

/** Separa nomes de arquivo iguais: "a.pdf", "a (2).pdf"... */
function nomesUnicos(nomes) {
  const vistos = new Map();
  return nomes.map((nome) => {
    const chave = nome.toLowerCase();
    const n = (vistos.get(chave) || 0) + 1;
    vistos.set(chave, n);
    if (n === 1) return nome;
    const ext = path.extname(nome);
    return `${nome.slice(0, nome.length - ext.length)} (${n})${ext}`;
  });
}

module.exports = {
  novoId,
  nomeSeguro,
  semExtensao,
  extensao,
  corrigirNomeUpload,
  limitar,
  booleano,
  ErroUsuario,
  Cancelado,
  nomesUnicos,
};
