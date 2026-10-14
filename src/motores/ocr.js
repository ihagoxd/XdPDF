'use strict';

/**
 * Reconhecimento de texto (Tesseract), tudo local.
 * Os dados de idioma ficam em vendor/tessdata (baixados uma vez).
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { ErroUsuario } = require('../nucleo/util');

const IDIOMAS_VALIDOS = new Set(['por', 'eng']);
const trabalhadores = new Map();
const ESPERA_OCIOSO = 4 * 60 * 1000;

function normalizarIdioma(texto) {
  const lista = String(texto || 'por').split('+').map((s) => s.trim()).filter((s) => IDIOMAS_VALIDOS.has(s));
  return lista.length ? Array.from(new Set(lista)).join('+') : 'por';
}

function verificarDados(idioma) {
  for (const lang of idioma.split('+')) {
    if (!fs.existsSync(path.join(config.vendor.tessdata, `${lang}.traineddata.gz`))) {
      throw new ErroUsuario(`Os dados do OCR (${lang}) não estão instalados. Rode "npm run ocr" com internet uma vez.`);
    }
  }
}

async function obter(idioma) {
  verificarDados(idioma);
  let item = trabalhadores.get(idioma);
  if (!item) {
    const { createWorker } = require('tesseract.js');
    item = {
      promessa: createWorker(idioma.split('+'), 1, {
        langPath: config.vendor.tessdata,
        cachePath: config.pastas.cacheOcr,
        gzip: true,
        logger: () => {},
        errorHandler: () => {},
      }),
      timer: null,
    };
    trabalhadores.set(idioma, item);
    item.promessa.catch(() => trabalhadores.delete(idioma));
  }
  clearTimeout(item.timer);
  item.timer = setTimeout(async () => {
    trabalhadores.delete(idioma);
    try { (await item.promessa).terminate(); } catch (_) { /* já encerrado */ }
  }, ESPERA_OCIOSO);
  item.timer.unref();
  return item.promessa;
}

/* Uma página por vez por idioma: o Tesseract já usa os núcleos da máquina. */
const filas = new Map();

/**
 * @param {Buffer} imagem  PNG/JPEG
 * @param {string} idiomaBruto 'por' | 'eng' | 'por+eng'
 * @returns {Promise<{linhas: {palavras: {texto:string, x0:number, y0:number, x1:number, y1:number, conf:number}[], base: object|null, y0:number, y1:number}[], texto: string}>}
 */
function reconhecer(imagem, idiomaBruto) {
  const idioma = normalizarIdioma(idiomaBruto);
  const anterior = filas.get(idioma) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(async () => {
    const trabalhador = await obter(idioma);
    const { data } = await trabalhador.recognize(imagem, {}, { blocks: true, text: true });
    const linhas = [];
    for (const bloco of data.blocks || []) {
      for (const par of bloco.paragraphs || []) {
        for (const l of par.lines || []) {
          const palavras = (l.words || [])
            .filter((w) => w.text && w.text.trim() && w.confidence > 15)
            .map((w) => ({ texto: w.text.trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence }));
          if (palavras.length) {
            linhas.push({
              palavras,
              y0: l.bbox.y0,
              y1: l.bbox.y1,
              base: l.baseline && l.baseline.has_baseline !== false ? l.baseline : null,
            });
          }
        }
      }
    }
    return { linhas, texto: data.text || '' };
  });
  filas.set(idioma, atual);
  return atual;
}

/** Fecha os trabalhadores do OCR (ao encerrar o app ou os testes). */
async function encerrarTodos() {
  const lista = Array.from(trabalhadores.values());
  trabalhadores.clear();
  await Promise.all(lista.map(async (item) => {
    clearTimeout(item.timer);
    try { (await item.promessa).terminate(); } catch (_) { /* já encerrado */ }
  }));
}

module.exports = { reconhecer, normalizarIdioma, encerrarTodos };
