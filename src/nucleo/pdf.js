'use strict';

/**
 * Funções comuns para abrir, inspecionar e salvar PDFs com o pdf-lib.
 *
 * Regra de ouro: toda ferramenta trabalha sobre a "cópia de trabalho" do
 * arquivo, que já está SEM criptografia. PDFs com restrição de impressão ou
 * cópia vêm criptografados (com senha de usuário vazia); se fossem abertos
 * ignorando a criptografia, o conteúdo copiado sairia ilegível e qualquer
 * coisa desenhada por cima ficaria invisível.
 */

const fsp = require('fs/promises');
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFNumber, PDFHexString,
} = require('@cantoo/pdf-lib');

const OPCOES_LEITURA = {
  updateMetadata: false,
  throwOnInvalidObject: false,
};

/** Acha o começo real do PDF: alguns arquivos têm lixo antes do cabeçalho. */
function inicioDoPdf(bytes) {
  const janela = Math.min(bytes.length, 4096);
  for (let i = 0; i <= janela - 5; i += 1) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return i;
    }
  }
  return -1;
}

function ehErroDeSenha(err) {
  const msg = String((err && err.message) || '');
  return /password/i.test(msg) || /encrypt/i.test(msg);
}

/** Remove a criptografia de um documento já aberto com a senha certa. */
function tirarCriptografia(doc) {
  const ref = doc.context.trailerInfo.Encrypt;
  doc.context.trailerInfo.Encrypt = undefined;
  if (ref instanceof PDFRef) doc.context.delete(ref);
  doc.isEncrypted = false;
  return doc;
}

/**
 * Abre bytes de PDF tentando, nesta ordem: sem senha, senha vazia (PDF só com
 * restrições) e a senha informada.
 * @returns {Promise<{doc: PDFDocument, criptografado: boolean}>}
 */
async function carregar(bytes, { senha } = {}) {
  const inicio = inicioDoPdf(bytes);
  if (inicio < 0) {
    const e = new Error('Este arquivo não é um PDF.');
    e.codigo = 'nao-pdf';
    throw e;
  }
  const dados = inicio > 0 ? bytes.subarray(inicio) : bytes;

  try {
    const doc = await PDFDocument.load(dados, OPCOES_LEITURA);
    coletarLixo(doc);
    return { doc, criptografado: false };
  } catch (err) {
    if (!ehErroDeSenha(err)) {
      const e = new Error('O PDF está danificado e não abriu.');
      e.codigo = 'corrompido';
      e.causa = err;
      throw e;
    }
  }

  // Criptografado: primeiro a senha vazia, que é o caso dos PDFs "travados".
  const tentativas = senha !== undefined && senha !== null && senha !== '' ? ['', String(senha)] : [''];
  for (const tentativa of tentativas) {
    try {
      const doc = await PDFDocument.load(dados, { ...OPCOES_LEITURA, password: tentativa });
      tirarCriptografia(doc);
      // sai a tabela antiga (que carrega o /Encrypt), o dicionário de senha e o lixo
      coletarLixo(doc);
      return { doc, criptografado: true, precisouSenha: tentativa !== '' };
    } catch (err) {
      if (!ehErroDeSenha(err)) {
        const e = new Error('Não foi possível abrir este PDF protegido.');
        e.codigo = 'corrompido';
        e.causa = err;
        throw e;
      }
    }
  }

  const e = new Error(senha ? 'Senha incorreta.' : 'Este PDF pede senha para abrir.');
  e.codigo = 'senha';
  throw e;
}

/** Abre a cópia de trabalho de um arquivo (já sem criptografia). */
async function abrir(caminho) {
  const bytes = await fsp.readFile(caminho);
  const { doc } = await carregar(bytes);
  return doc;
}

async function salvar(doc, { objetosCompactos = true } = {}) {
  return Buffer.from(await doc.save({ useObjectStreams: objetosCompactos, addDefaultPage: false }));
}

/** Documento novo, sem o pdf-lib se anunciar como autor. */
async function novo() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('XdPDF');
  doc.setCreator('XdPDF');
  const agora = new Date();
  doc.setCreationDate(agora);
  doc.setModificationDate(agora);
  return doc;
}

const isoladas = new WeakSet();

/**
 * Antes de desenhar numa página existente: cerca o conteúdo original com
 * q ... Q. Muitos PDFs deixam a matriz de transformação alterada no fim do
 * conteúdo; sem isso, número de página, marca d'água e assinatura sairiam
 * deslocados ou na escala errada.
 */
function isolarConteudo(pagina) {
  if (isoladas.has(pagina)) return;
  isoladas.add(pagina);
  // normalize() do pdf-lib (autoNormalizeCTM) já envolve o conteúdo em q/Q
  // e transforma /Contents numa lista.
  pagina.node.normalize();
}

/**
 * Desenha "por baixo" do conteúdo original: o que for desenhado em `fn`
 * vai para o começo da lista de conteúdos da página.
 */
function desenharPorBaixo(pagina, fn) {
  isolarConteudo(pagina);
  const antes = pagina.node.Contents();
  const tamanhoAntes = antes instanceof PDFArray ? antes.size() : 0;
  fn();
  const lista = pagina.node.Contents();
  if (!(lista instanceof PDFArray) || lista.size() <= tamanhoAntes) return;
  const ref = lista.get(lista.size() - 1);
  lista.remove(lista.size() - 1);
  lista.insert(0, ref);
}

/** "#rrggbb" -> cor do pdf-lib */
function cor(hex, padrao = '#000000') {
  const { rgb } = require('@cantoo/pdf-lib');
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')) || /^#?([0-9a-f]{6})$/i.exec(padrao);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/* ============================================================
   GEOMETRIA: o que a pessoa vê -> coordenadas do PDF
   ============================================================

   Na tela a página aparece já girada (/Rotate) e recortada (CropBox).
   As ferramentas recebem posições "visuais" com origem no canto inferior
   esquerdo da página como ela aparece (eixo y para cima), e aqui viram
   coordenadas do PDF, considerando o giro e o deslocamento da caixa. */

function rotacaoDe(pagina) {
  const r = pagina.getRotation().angle || 0;
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

function caixaVisivel(pagina) {
  const media = pagina.getMediaBox();
  let caixa = media;
  try { caixa = pagina.getCropBox(); } catch (_) { /* sem CropBox */ }
  // A área visível é a interseção das duas.
  const x0 = Math.max(caixa.x, media.x);
  const y0 = Math.max(caixa.y, media.y);
  const x1 = Math.min(caixa.x + caixa.width, media.x + media.width);
  const y1 = Math.min(caixa.y + caixa.height, media.y + media.height);
  if (x1 - x0 < 1 || y1 - y0 < 1) return media;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * @returns {{largura:number, altura:number, rotacao:number,
 *            ponto:(u:number,v:number)=>{x:number,y:number}}}
 *   largura/altura: tamanho como aparece na tela (pontos)
 *   ponto(u, v): posição visual (origem embaixo à esquerda) -> coordenada do PDF
 */
function visao(pagina) {
  const c = caixaVisivel(pagina);
  const r = rotacaoDe(pagina);
  const x0 = c.x;
  const y0 = c.y;
  const x1 = c.x + c.width;
  const y1 = c.y + c.height;
  const deitada = r === 90 || r === 270;
  const largura = deitada ? c.height : c.width;
  const altura = deitada ? c.width : c.height;

  let ponto;
  if (r === 90) ponto = (u, v) => ({ x: x1 - v, y: y0 + u });
  else if (r === 180) ponto = (u, v) => ({ x: x1 - u, y: y1 - v });
  else if (r === 270) ponto = (u, v) => ({ x: x0 + v, y: y1 - u });
  else ponto = (u, v) => ({ x: x0 + u, y: y0 + v });

  return { largura, altura, rotacao: r, ponto, caixa: c };
}

/**
 * Converte uma caixa visual normalizada (0..1, origem no canto SUPERIOR
 * esquerdo, como no navegador) para pontos visuais com origem embaixo.
 */
function caixaNormalizada(v, caixa) {
  const x = Number(caixa.x) * v.largura;
  const largura = Number(caixa.w) * v.largura;
  const altura = Number(caixa.h) * v.altura;
  const yTopo = Number(caixa.y) * v.altura;
  return { x, y: v.altura - yTopo - altura, largura, altura };
}

/* ============================================================
   LIMPEZA: remove objetos que nada mais referencia

   Roda logo ao abrir. O pdf-lib mantém as tabelas de referência antigas
   (/Type /XRef) e objetos que não conseguiu ler como objetos comuns e os
   regrava no arquivo novo; ao reabrir, essas tabelas velhas "voltam a valer"
   e trazem de volta /Encrypt, /Root e /Info antigos.
   ============================================================ */

function coletarLixo(doc) {
  const ctx = doc.context;
  const vivos = new Set();
  const pilha = [];

  const visitar = (obj) => {
    if (!obj) return;
    if (obj instanceof PDFRef) {
      const chave = obj.toString();
      if (vivos.has(chave)) return;
      vivos.add(chave);
      pilha.push(ctx.lookup(obj));
      return;
    }
    pilha.push(obj);
  };

  const t = ctx.trailerInfo;
  [t.Root, t.Info, t.Encrypt, t.ID].forEach(visitar);

  while (pilha.length) {
    const obj = pilha.pop();
    if (!obj) continue;
    if (obj instanceof PDFDict) {
      for (const [, valor] of obj.entries()) visitar(valor);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) visitar(obj.get(i));
    } else if (obj instanceof PDFStream) {
      visitar(obj.dict);
    } else if (obj instanceof PDFRef) {
      visitar(obj);
    }
  }

  let removidos = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!vivos.has(ref.toString())) {
      ctx.delete(ref);
      removidos += 1;
    }
  }
  return removidos;
}

/* ============================================================
   MARCADORES (sumário lateral do PDF)
   ============================================================ */

/**
 * Cria marcadores de primeiro nível.
 * @param {PDFDocument} doc
 * @param {{titulo:string, pagina:number}[]} itens pagina = índice 0-based
 */
function criarMarcadores(doc, itens) {
  const ctx = doc.context;
  const validos = itens.filter((i) => i.pagina >= 0 && i.pagina < doc.getPageCount());
  if (!validos.length) return;

  const raizRef = ctx.nextRef();
  const refs = validos.map(() => ctx.nextRef());
  const paginas = doc.getPages();

  validos.forEach((item, i) => {
    const destino = ctx.obj([paginas[item.pagina].ref, PDFName.of('XYZ'), null, null, null]);
    const dict = ctx.obj({
      Title: PDFHexString.fromText(String(item.titulo).slice(0, 200)),
      Parent: raizRef,
      Dest: destino,
    });
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], dict);
  });

  ctx.assign(raizRef, ctx.obj({
    Type: 'Outlines',
    First: refs[0],
    Last: refs[refs.length - 1],
    Count: PDFNumber.of(refs.length),
  }));
  doc.catalog.set(PDFName.of('Outlines'), raizRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

module.exports = {
  PDFDocument,
  PDFRawStream,
  carregar,
  abrir,
  salvar,
  novo,
  isolarConteudo,
  desenharPorBaixo,
  cor,
  tirarCriptografia,
  inicioDoPdf,
  visao,
  caixaNormalizada,
  rotacaoDe,
  coletarLixo,
  criarMarcadores,
};
