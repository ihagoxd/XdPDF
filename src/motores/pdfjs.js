'use strict';

/**
 * pdf.js rodando no servidor: desenha páginas em imagem e lê o texto com a
 * posição de cada trecho. Usa o @napi-rs/canvas (já vem com o pdfjs-dist).
 */

const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const config = require('../config');

let modulo = null;

function carregar() {
  if (!modulo) {
    const alvo = path.join(config.vendor.pdfjs, 'legacy', 'build', 'pdf.mjs');
    modulo = import(pathToFileURL(alvo).href);
  }
  return modulo;
}

const barra = (p) => `${p.replace(/\\/g, '/')}/`;

/** Abre um PDF (caminho ou bytes). Lembre de chamar doc.destroy() no fim. */
async function abrir(origem, { senha } = {}) {
  const pdfjs = await carregar();
  const dados = typeof origem === 'string' ? await fsp.readFile(origem) : origem;
  return pdfjs.getDocument({
    data: new Uint8Array(dados.buffer ? dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength) : dados),
    password: senha,
    verbosity: 0,
    isEvalSupported: false,
    standardFontDataUrl: barra(path.join(config.vendor.pdfjs, 'standard_fonts')),
    cMapUrl: barra(path.join(config.vendor.pdfjs, 'cmaps')),
    cMapPacked: true,
  }).promise;
}

const MAX_PIXELS = 36e6; // ~ A3 a 300 dpi; acima disso a escala cai

/**
 * Desenha uma página.
 * @param {*} doc     documento do pdf.js
 * @param {number} n  página (1-based)
 * @param {{dpi?:number, formato?:'jpeg'|'png', qualidade?:number, antes?:Function, depois?:Function}} op
 *   depois(ctx, vp): desenha por cima (tarjas)
 * @returns {Promise<{bytes:Buffer, largura:number, altura:number, escala:number, larguraPt:number, alturaPt:number}>}
 */
async function desenhar(doc, n, { dpi = 150, formato = 'jpeg', qualidade = 88, depois } = {}) {
  const pagina = await doc.getPage(n);
  try {
    const base = pagina.getViewport({ scale: 1 });
    let escala = dpi / 72;
    const px = base.width * base.height * escala * escala;
    if (px > MAX_PIXELS) escala *= Math.sqrt(MAX_PIXELS / px);
    const vp = pagina.getViewport({ scale: escala });
    const largura = Math.max(1, Math.round(vp.width));
    const altura = Math.max(1, Math.round(vp.height));
    const { canvas, context } = doc.canvasFactory.create(largura, altura);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, largura, altura);
    // modo padrão de anotações: campos de formulário e carimbos saem desenhados na imagem
    await pagina.render({ canvasContext: context, viewport: vp }).promise;
    if (depois) depois(context, vp, largura, altura);
    const bytes = formato === 'png'
      ? await canvas.encode('png')
      : await canvas.encode('jpeg', qualidade);
    doc.canvasFactory.destroy({ canvas, context });
    return { bytes: Buffer.from(bytes), largura, altura, escala, larguraPt: base.width, alturaPt: base.height };
  } finally {
    pagina.cleanup();
  }
}

/**
 * Trechos de texto da página, em coordenadas visuais (pontos, origem no
 * canto superior esquerdo da página como ela aparece).
 * @returns {Promise<{largura:number, altura:number, itens:{texto:string,x:number,y:number,l:number,a:number,fonte:string,tamanho:number,negrito:boolean,italico:boolean}[]}>}
 */
async function textoDaPagina(doc, n) {
  const pdfjs = await carregar();
  const pagina = await doc.getPage(n);
  try {
    const vp = pagina.getViewport({ scale: 1 });
    const conteudo = await pagina.getTextContent({ disableNormalization: false });
    const estilos = conteudo.styles || {};
    let nomesFontes = null;
    const itens = [];
    for (const it of conteudo.items) {
      if (typeof it.str !== 'string' || !it.str.length) continue;
      const m = pdfjs.Util.transform(vp.transform, it.transform);
      const tamanho = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 10;
      // m[4], m[5] = início da linha de base, já na tela (y para baixo)
      const vertical = Math.abs(m[1]) > Math.abs(m[0]);
      const l = vertical ? it.height || tamanho : it.width * (vp.scale || 1);
      itens.push({
        texto: it.str,
        x: m[4],
        y: m[5] - tamanho * 0.82,
        base: m[5],
        l: Math.abs(l),
        a: tamanho,
        tamanho,
        fonte: it.fontName,
        familia: (estilos[it.fontName] || {}).fontFamily || '',
        vertical,
        fimDeLinha: Boolean(it.hasEOL),
      });
    }
    // nomes reais das fontes (para achar negrito/itálico) só existem depois de carregá-las
    if (itens.length) {
      try {
        await pagina.getOperatorList();
        nomesFontes = {};
        for (const it of itens) {
          if (nomesFontes[it.fonte] !== undefined) continue;
          let nome = '';
          try {
            const f = pagina.commonObjs.get(it.fonte);
            nome = `${f.name || ''} ${f.loadedName || ''} ${f.bold ? 'bold' : ''} ${f.italic ? 'italic' : ''}`;
          } catch (_) { /* fonte não carregada */ }
          nomesFontes[it.fonte] = nome;
        }
      } catch (_) { nomesFontes = null; }
    }
    for (const it of itens) {
      const nome = `${(nomesFontes && nomesFontes[it.fonte]) || ''} ${it.familia}`;
      it.negrito = /bold|black|heavy|semibold|demi|\bbd\b|-b\b|,b\b/i.test(nome);
      it.italico = /italic|oblique|\bit\b/i.test(nome);
    }
    return { largura: vp.width, altura: vp.height, itens };
  } finally {
    pagina.cleanup();
  }
}

module.exports = { carregar, abrir, desenhar, textoDaPagina };
