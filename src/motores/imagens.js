'use strict';

/**
 * Imagens com o sharp: ler, endireitar (foto de celular vem deitada pelo
 * EXIF), converter formatos que o PDF não aceita e recomprimir.
 */

const sharp = require('sharp');
const { ErroUsuario } = require('../nucleo/util');

sharp.cache(false);
sharp.concurrency(2);

const EXT_IMAGEM = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.tif', '.tiff', '.avif', '.bmp']);

const TAMANHOS = {
  a4: [595.28, 841.89],
  carta: [612, 792],
  oficio: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
};

const MARGENS = { nenhuma: 0, pequena: 20, grande: 50 };

function ehImagem(ext) {
  return EXT_IMAGEM.has(String(ext).toLowerCase());
}

/** BMP o sharp não lê; convertemos à mão (24/32 bits sem compressão, o comum). */
function bmpParaRaw(bytes) {
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inicio = v.getUint32(10, true);
  const largura = v.getInt32(18, true);
  let altura = v.getInt32(22, true);
  const bits = v.getUint16(28, true);
  const compressao = v.getUint32(30, true);
  if ((bits !== 24 && bits !== 32) || (compressao !== 0 && compressao !== 3)) return null;
  const deCimaParaBaixo = altura < 0;
  altura = Math.abs(altura);
  const bpp = bits / 8;
  const linha = Math.ceil((largura * bpp) / 4) * 4;
  const raw = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y += 1) {
    const origem = inicio + (deCimaParaBaixo ? y : altura - 1 - y) * linha;
    for (let x = 0; x < largura; x += 1) {
      const o = origem + x * bpp;
      const d = (y * largura + x) * 3;
      raw[d] = bytes[o + 2];
      raw[d + 1] = bytes[o + 1];
      raw[d + 2] = bytes[o];
    }
  }
  return { raw, largura, altura };
}

function abrirSharp(entrada, opcoes = {}) {
  const bytes = Buffer.isBuffer(entrada) ? entrada : null;
  if (bytes) {
    const bmp = bmpParaRaw(bytes);
    if (bmp) return sharp(bmp.raw, { raw: { width: bmp.largura, height: bmp.altura, channels: 3 } });
  }
  return sharp(entrada, { failOn: 'none', limitInputPixels: 400e6, ...opcoes });
}

/** Informações da imagem já considerando a rotação do EXIF. */
async function ler(bytes) {
  let meta;
  try {
    meta = await abrirSharp(bytes).metadata();
  } catch (_) {
    throw new ErroUsuario('Não foi possível ler esta imagem.');
  }
  const deitada = meta.orientation >= 5 && meta.orientation <= 8;
  return {
    largura: deitada ? meta.height : meta.width,
    altura: deitada ? meta.width : meta.height,
    formato: meta.format,
    paginas: meta.pages || 1,
    alfa: Boolean(meta.hasAlpha),
    dpi: meta.density && meta.density > 30 && meta.density < 2400 ? meta.density : null,
    orientacao: meta.orientation || 1,
    cmyk: meta.space === 'cmyk',
  };
}

/**
 * Prepara uma imagem para embutir no PDF.
 * JPEG que já está bom entra como veio (sem perder qualidade).
 * @returns {Promise<{bytes:Buffer, tipo:'jpg'|'png', largura:number, altura:number, dpi:number|null}>}
 */
async function paraEmbutir(bytes, { pagina = 0, maxPx = 0, qualidade = 90 } = {}) {
  const info = await ler(bytes);
  const maior = Math.max(info.largura, info.altura);
  const reduzir = maxPx > 0 && maior > maxPx;

  if (info.formato === 'jpeg' && info.orientacao <= 1 && !reduzir && !info.cmyk && info.paginas === 1) {
    return { bytes, tipo: 'jpg', largura: info.largura, altura: info.altura, dpi: info.dpi };
  }

  let img = abrirSharp(bytes, info.paginas > 1 ? { page: pagina } : {}).rotate();
  if (reduzir) img = img.resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true });

  // Transparência de verdade vira PNG; o resto vira JPEG (bem menor).
  let usaAlfa = false;
  if (info.alfa) {
    try { usaAlfa = !(await img.clone().stats()).isOpaque; } catch (_) { usaAlfa = true; }
  }

  const saida = usaAlfa
    ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await img.flatten({ background: '#ffffff' }).toColourspace('srgb')
      .jpeg({ quality: qualidade, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  return {
    bytes: saida.data,
    tipo: usaAlfa ? 'png' : 'jpg',
    largura: saida.info.width,
    altura: saida.info.height,
    dpi: reduzir ? null : info.dpi,
  };
}

/**
 * Adiciona a imagem como uma página nova do documento.
 * @param {import('@cantoo/pdf-lib').PDFDocument} doc
 * @param {{bytes:Buffer,tipo:string,largura:number,altura:number,dpi:number|null}} img
 * @param {{tamanho?:string, orientacao?:string, margem?:string}} opcoes
 *   tamanho: 'a4' | 'carta' | 'oficio' | 'a3' | 'a5' | 'imagem'
 *   orientacao: 'auto' | 'retrato' | 'paisagem'
 */
async function adicionarPagina(doc, img, { tamanho = 'a4', orientacao = 'auto', margem = 'pequena' } = {}) {
  const embutida = img.tipo === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  const dpi = img.dpi || 96;
  // tamanho "natural" da imagem em pontos
  const naturalL = (img.largura * 72) / dpi;
  const naturalA = (img.altura * 72) / dpi;

  if (tamanho === 'imagem') {
    const pagina = doc.addPage([naturalL, naturalA]);
    pagina.drawImage(embutida, { x: 0, y: 0, width: naturalL, height: naturalA });
    return pagina;
  }

  let [pl, pa] = TAMANHOS[tamanho] || TAMANHOS.a4;
  const paisagem = orientacao === 'paisagem' || (orientacao === 'auto' && img.largura > img.altura);
  if (paisagem) [pl, pa] = [pa, pl];

  const m = MARGENS[margem] != null ? MARGENS[margem] : MARGENS.pequena;
  const areaL = pl - m * 2;
  const areaA = pa - m * 2;
  // Cabe na página; imagem pequena fica no tamanho natural, sem esticar e borrar.
  const escala = Math.min(areaL / naturalL, areaA / naturalA, 1);
  const l = naturalL * escala;
  const a = naturalA * escala;

  const pagina = doc.addPage([pl, pa]);
  pagina.drawImage(embutida, { x: (pl - l) / 2, y: (pa - a) / 2, width: l, height: a });
  return pagina;
}

module.exports = { ehImagem, ler, paraEmbutir, adicionarPagina, abrirSharp, TAMANHOS, EXT_IMAGEM };
