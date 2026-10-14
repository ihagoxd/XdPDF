'use strict';

/**
 * Camada de texto invisível sobre a página (resultado do OCR).
 * Cada palavra é escrita no lugar exato onde aparece na imagem, esticada para
 * a mesma largura, em modo invisível (Tr 3). Assim a busca e a seleção
 * funcionam e a aparência da página não muda nada.
 */

const {
  StandardFonts, TextRenderingMode,
  pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize,
  setTextRenderingMode, setCharacterSqueeze, setTextMatrix, showText,
} = require('@cantoo/pdf-lib');

const pdf = require('../nucleo/pdf');
const { paraWinAnsi } = require('../nucleo/fontes');

const fontesPorDoc = new WeakMap();

async function fonteInvisivel(doc) {
  if (!fontesPorDoc.has(doc)) fontesPorDoc.set(doc, doc.embedFont(StandardFonts.Helvetica));
  return fontesPorDoc.get(doc);
}

/**
 * @param {import('@cantoo/pdf-lib').PDFDocument} doc
 * @param {import('@cantoo/pdf-lib').PDFPage} pagina
 * @param {{linhas: any[]}} ocr  resultado do motor de OCR
 * @param {number} escala  pixels da imagem por ponto do PDF
 * @returns {number} palavras escritas
 */
async function escrever(doc, pagina, ocr, escala) {
  const fonte = await fonteInvisivel(doc);
  pdf.isolarConteudo(pagina);
  const v = pdf.visao(pagina);
  const chave = pagina.node.newFontDictionary(fonte.name, fonte.ref);
  const r = (v.rotacao * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let total = 0;

  for (const linha of ocr.linhas) {
    const alturaPx = Math.max(linha.y1 - linha.y0, 4);
    const tamanho = Math.max((alturaPx / escala) * 0.8, 2);
    linha.palavras.forEach((p, i) => {
      const texto = paraWinAnsi(p.texto) + (i < linha.palavras.length - 1 ? ' ' : '');
      const limpo = texto.trim();
      if (!limpo) return;
      // linha de base: a do Tesseract se houver; senão, perto do pé da palavra
      let basePx = p.y1 - (linha.y1 - linha.y0) * 0.2;
      if (linha.base) {
        const b = linha.base;
        const t = b.x1 !== b.x0 ? (p.x0 - b.x0) / (b.x1 - b.x0) : 0;
        basePx = b.y0 + (b.y1 - b.y0) * t;
      }
      const u = p.x0 / escala;
      const vy = v.altura - basePx / escala;
      const larguraPt = Math.max((p.x1 - p.x0) / escala, 0.5);
      const larguraTexto = fonte.widthOfTextAtSize(limpo, tamanho) || larguraPt;
      const estica = Math.max(Math.min((larguraPt / larguraTexto) * 100, 1000), 5);
      const pt = v.ponto(u, vy);
      ops.push(
        setFontAndSize(chave, tamanho),
        setCharacterSqueeze(estica),
        setTextMatrix(cos, sin, -sin, cos, pt.x, pt.y),
        showText(fonte.encodeText(texto)),
      );
      total += 1;
    });
  }

  ops.push(endText(), popGraphicsState());
  if (total) pagina.pushOperators(...ops);
  return total;
}

module.exports = { escrever };
