'use strict';

/**
 * Compressão de PDF sem transformar as páginas em imagem.
 *
 * O que pesa num PDF quase sempre são as imagens (fotos, digitalizações).
 * Aqui cada imagem é decodificada, reduzida para a resolução necessária e
 * regravada em JPEG. O texto, as fontes e os vetores ficam intactos —
 * continuam selecionáveis e nítidos.
 */

const zlib = require('zlib');
const { PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, PDFRef, PDFStream, PDFBool } = require('@cantoo/pdf-lib');
const sharp = require('sharp');

const pdfUtil = require('../nucleo/pdf');

const NIVEIS = {
  extrema: { dpi: 96, qualidade: 45 },
  recomendada: { dpi: 144, qualidade: 62 },
  leve: { dpi: 220, qualidade: 80 },
};

function nome(obj) {
  return obj instanceof PDFName ? obj.decodeText() : null;
}

function filtros(dict) {
  const f = dict.lookup(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFName) return [nome(f)];
  if (f instanceof PDFArray) return f.asArray().map((x) => nome(x instanceof PDFRef ? null : x)).filter(Boolean);
  return ['?'];
}

function numero(dict, chave, padrao = null) {
  const v = dict.lookup(PDFName.of(chave));
  return v instanceof PDFNumber ? v.asNumber() : padrao;
}

/** Quantos canais tem o espaço de cor (ou null se não dá para tratar). */
function canaisDe(ctx, cs) {
  const valor = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (valor instanceof PDFName) {
    const n = nome(valor);
    if (n === 'DeviceRGB' || n === 'CalRGB') return 3;
    if (n === 'DeviceGray' || n === 'CalGray') return 1;
    return null; // CMYK e afins: deixa como está
  }
  if (valor instanceof PDFArray && valor.size() >= 2) {
    const tipo = nome(valor.lookup(0));
    if (tipo === 'ICCBased') {
      const perfil = valor.lookup(1);
      if (perfil instanceof PDFStream) {
        const n = numero(perfil.dict, 'N');
        return n === 1 || n === 3 ? n : null;
      }
    }
    if (tipo === 'CalRGB') return 3;
    if (tipo === 'CalGray') return 1;
  }
  return null;
}

/** Desfaz o filtro PNG (Predictor 10-15) linha a linha. */
function desfazerPredicao(dados, largura, canais, altura) {
  const linha = largura * canais;
  const saida = Buffer.alloc(linha * altura);
  let anterior = Buffer.alloc(linha);
  for (let y = 0; y < altura; y += 1) {
    const ini = y * (linha + 1);
    if (ini + linha + 1 > dados.length) return null;
    const tipo = dados[ini];
    const atual = saida.subarray(y * linha, (y + 1) * linha);
    for (let x = 0; x < linha; x += 1) {
      const bruto = dados[ini + 1 + x];
      const esq = x >= canais ? atual[x - canais] : 0;
      const cima = anterior[x];
      const diag = x >= canais ? anterior[x - canais] : 0;
      let v;
      switch (tipo) {
        case 0: v = bruto; break;
        case 1: v = bruto + esq; break;
        case 2: v = bruto + cima; break;
        case 3: v = bruto + ((esq + cima) >> 1); break;
        case 4: {
          const p = esq + cima - diag;
          const pa = Math.abs(p - esq);
          const pb = Math.abs(p - cima);
          const pc = Math.abs(p - diag);
          v = bruto + (pa <= pb && pa <= pc ? esq : pb <= pc ? cima : diag);
          break;
        }
        default: return null;
      }
      atual[x] = v & 255;
    }
    anterior = atual;
  }
  return saida;
}

/** Imagens usadas como máscara de outras ficam como estão. */
function referenciasDeMascaras(ctx) {
  const mascaras = new Set();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict) continue;
    for (const chave of ['SMask', 'Mask']) {
      const v = dict.get(PDFName.of(chave));
      if (v instanceof PDFRef) mascaras.add(v.toString());
    }
  }
  return mascaras;
}

/**
 * Recomprime as imagens do documento.
 * @returns {Promise<{trocadas:number, economia:number}>}
 */
async function recomprimirImagens(doc, nivelBruto = 'recomendada', { cinza = false, aoProgredir, checar } = {}) {
  const nivel = NIVEIS[nivelBruto] || NIVEIS.recomendada;
  const ctx = doc.context;
  const mascaras = referenciasDeMascaras(ctx);

  // maior lado de página, em polegadas: define o tamanho máximo útil de uma imagem
  let maiorLado = 11.7;
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    maiorLado = Math.max(maiorLado, Math.max(width, height) / 72);
  }
  const limitePx = Math.ceil(maiorLado * nivel.dpi);

  const candidatas = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (nome(d.lookup(PDFName.of('Subtype'))) !== 'Image') continue;
    if (mascaras.has(ref.toString())) continue;
    const im = d.lookup(PDFName.of('ImageMask'));
    if (im instanceof PDFBool && im.asBoolean()) continue;
    if (d.lookup(PDFName.of('Mask')) instanceof PDFArray) continue; // máscara por cor exige pixels exatos
    if (obj.contents.length < 12 * 1024) continue;
    candidatas.push([ref, obj]);
  }

  let trocadas = 0;
  let economia = 0;
  for (let i = 0; i < candidatas.length; i += 1) {
    if (checar) checar();
    const [ref, obj] = candidatas[i];
    if (aoProgredir) aoProgredir(i / candidatas.length, `Comprimindo imagem ${i + 1} de ${candidatas.length}`);
    try {
      const novo = await recomprimir(ctx, obj, nivel, limitePx, cinza);
      if (novo && novo.contents.length < obj.contents.length * 0.92) {
        economia += obj.contents.length - novo.contents.length;
        ctx.assign(ref, novo);
        trocadas += 1;
      }
    } catch (_) {
      // imagem num formato que não sabemos tratar: fica como estava
    }
  }
  return { trocadas, economia };
}

async function recomprimir(ctx, obj, nivel, limitePx, cinza) {
  const d = obj.dict;
  const largura = numero(d, 'Width');
  const altura = numero(d, 'Height');
  if (!largura || !altura || largura * altura < 150 * 150) return null;
  const fs = filtros(d);
  let entrada;

  if (fs.length === 1 && fs[0] === 'DCTDecode') {
    if (d.lookup(PDFName.of('Decode'))) return null;
    const canais = canaisDe(ctx, d.get(PDFName.of('ColorSpace')));
    if (!canais) return null; // CMYK: o JPEG pode vir invertido
    entrada = sharp(Buffer.from(obj.contents), { failOn: 'none' });
  } else if (fs.length <= 1 && (fs[0] === 'FlateDecode' || fs.length === 0)) {
    if (numero(d, 'BitsPerComponent') !== 8) return null;
    if (d.lookup(PDFName.of('Decode'))) return null;
    const canais = canaisDe(ctx, d.get(PDFName.of('ColorSpace')));
    if (!canais) return null;
    let bruto = fs.length ? zlib.inflateSync(Buffer.from(obj.contents)) : Buffer.from(obj.contents);
    const parms = d.lookup(PDFName.of('DecodeParms'));
    const preditor = parms instanceof PDFDict ? numero(parms, 'Predictor', 1) : 1;
    if (preditor >= 10) {
      const colunas = numero(parms, 'Columns', largura);
      const cores = numero(parms, 'Colors', canais);
      if (colunas !== largura || cores !== canais) return null;
      bruto = desfazerPredicao(bruto, largura, canais, altura);
      if (!bruto) return null;
    } else if (preditor !== 1) {
      return null;
    }
    if (bruto.length < largura * altura * canais) return null;
    entrada = sharp(bruto.subarray(0, largura * altura * canais), { raw: { width: largura, height: altura, channels: canais } });
  } else {
    return null; // JBIG2, CCITT, JPEG 2000: já são compactos ou não dá para ler
  }

  let img = entrada;
  if (Math.max(largura, altura) > limitePx) {
    img = img.resize({ width: limitePx, height: limitePx, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' });
  }
  const meta = await entrada.metadata().catch(() => ({}));
  const tonsCinza = cinza || meta.channels === 1 || meta.space === 'b-w';
  if (tonsCinza) img = img.toColourspace('b-w');
  else img = img.toColourspace('srgb');
  const { data, info } = await img
    .jpeg({ quality: nivel.qualidade, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer({ resolveWithObject: true });

  const dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: info.width,
    Height: info.height,
    ColorSpace: info.channels === 1 ? 'DeviceGray' : 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
  });
  for (const chave of ['SMask', 'Intent', 'Interpolate', 'Name', 'StructParent', 'OC', 'Metadata']) {
    const v = d.get(PDFName.of(chave));
    if (v !== undefined) dict.set(PDFName.of(chave), v);
  }
  return PDFRawStream.of(dict, new Uint8Array(data));
}

/** Comprime sem perdas os fluxos que vieram sem compressão nenhuma. */
function comprimirFluxosSoltos(doc) {
  const ctx = doc.context;
  let n = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.has(PDFName.of('Filter'))) continue;
    if (obj.contents.length < 1024) continue;
    const tipo = nome(d.lookup(PDFName.of('Type')));
    if (tipo === 'Metadata') continue; // XMP precisa ficar legível
    const comprimido = zlib.deflateSync(Buffer.from(obj.contents), { level: 9 });
    if (comprimido.length >= obj.contents.length) continue;
    const dict = d.clone(ctx);
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.delete(PDFName.of('Length'));
    ctx.assign(ref, PDFRawStream.of(dict, new Uint8Array(comprimido)));
    n += 1;
  }
  return n;
}

module.exports = { recomprimirImagens, comprimirFluxosSoltos, coletarLixo: pdfUtil.coletarLixo, NIVEIS };
