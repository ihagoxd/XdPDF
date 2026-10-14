'use strict';

/**
 * Fontes para escrever texto nos PDFs (numeração, marca d'água, edição).
 *
 * As 14 fontes padrão do PDF não precisam ser embutidas, mas só conhecem a
 * tabela WinAnsi (acentos do português passam; emoji e símbolos não). Quando o
 * texto tem algo fora dela, usamos uma fonte TrueType do sistema, embutida
 * só com as letras usadas.
 */

const fs = require('fs');
const path = require('path');
const { StandardFonts } = require('@cantoo/pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const WIN = process.env.WINDIR || 'C:\\Windows';

const SISTEMA = {
  sans: [
    path.join(WIN, 'Fonts', 'arial.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  'sans-negrito': [
    path.join(WIN, 'Fonts', 'arialbd.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ],
  serif: [
    path.join(WIN, 'Fonts', 'times.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  ],
  'serif-negrito': [
    path.join(WIN, 'Fonts', 'timesbd.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
  ],
  mono: [
    path.join(WIN, 'Fonts', 'cour.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  ],
  'mono-negrito': [
    path.join(WIN, 'Fonts', 'courbd.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
  ],
};

const PADRAO = {
  sans: StandardFonts.Helvetica,
  'sans-negrito': StandardFonts.HelveticaBold,
  serif: StandardFonts.TimesRoman,
  'serif-negrito': StandardFonts.TimesRomanBold,
  mono: StandardFonts.Courier,
  'mono-negrito': StandardFonts.CourierBold,
};

// Caracteres que a codificação WinAnsi (fontes padrão) aceita.
const WINANSI = /^[\x20-\x7E\u00A0-\u00FF\u20AC\u0152\u0153\u0160\u0161\u017D\u017E\u0178\u0192\u2020\u2021\u2030\u2039\u203A\u2022\u2122\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2026\n\r\t]*$/;

const TROCAS = { '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u00AD': '', '\u200B': '' };

function cabeNaWinAnsi(texto) {
  return WINANSI.test(texto);
}

/** Para as fontes padrão: troca o que dá e remove o resto. */
function paraWinAnsi(texto) {
  let s = String(texto == null ? '' : texto).normalize('NFC');
  s = s.replace(/[\u2212\u2010\u2011\u00AD\u200B]/g, (c) => TROCAS[c]);
  return Array.from(s).filter((c) => cabeNaWinAnsi(c)).join('');
}

const cacheBytes = new Map();

function lerFonteDoSistema(estilo) {
  if (cacheBytes.has(estilo)) return cacheBytes.get(estilo);
  const achado = (SISTEMA[estilo] || []).find((c) => {
    try { return fs.existsSync(c); } catch (_) { return false; }
  });
  const bytes = achado ? fs.readFileSync(achado) : null;
  cacheBytes.set(estilo, bytes);
  return bytes;
}

/**
 * Embute a fonte adequada para os textos que vão ser escritos.
 * @param {import('@cantoo/pdf-lib').PDFDocument} doc
 * @param {string} familia 'sans' | 'serif' | 'mono'
 * @param {boolean} negrito
 * @param {string[]} textos  tudo que vai ser escrito com ela
 * @returns {Promise<{fonte: any, preparar: (t:string)=>string}>}
 */
async function fonteParaTextos(doc, familia = 'sans', negrito = false, textos = []) {
  const estilo = `${['sans', 'serif', 'mono'].includes(familia) ? familia : 'sans'}${negrito ? '-negrito' : ''}`;
  const precisaUnicode = textos.some((t) => !cabeNaWinAnsi(String(t || '')));

  if (precisaUnicode) {
    const bytes = lerFonteDoSistema(estilo);
    if (bytes) {
      doc.registerFontkit(fontkit);
      const fonte = await doc.embedFont(bytes, { subset: true });
      const disponiveis = new Set(fonte.getCharacterSet());
      const preparar = (t) => {
        // tira o que nem a fonte do sistema tem
        const s = String(t == null ? '' : t).normalize('NFC');
        return Array.from(s).filter((c) => c === '\n' || disponiveis.has(c.codePointAt(0))).join('');
      };
      return { fonte, preparar };
    }
  }
  const fonte = await doc.embedFont(PADRAO[estilo]);
  return { fonte, preparar: paraWinAnsi };
}

module.exports = { fonteParaTextos, paraWinAnsi, cabeNaWinAnsi };
