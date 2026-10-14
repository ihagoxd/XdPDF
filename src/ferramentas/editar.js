'use strict';

/**
 * Editar: numerar, marca d'água, elementos (texto/imagem/assinatura),
 * recortar, propriedades e achatar.
 */

const crypto = require('crypto');
const {
  degrees, PDFName, PDFArray, PDFDict, PDFStream, PDFNumber, PDFRef,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
} = require('@cantoo/pdf-lib');

const pdf = require('../nucleo/pdf');
const paginas = require('../nucleo/paginas');
const { fonteParaTextos } = require('../nucleo/fontes');
const { semExtensao, limitar, booleano, ErroUsuario } = require('../nucleo/util');
const { registrar } = require('./index');

const MM = 72 / 25.4;
const RAD = Math.PI / 180;

/* ---------------- utilidades ---------------- */

function lerImagemDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new ErroUsuario('Imagem inválida. Use PNG ou JPG.');
  return { tipo: m[1].toLowerCase() === 'png' ? 'png' : 'jpg', bytes: Buffer.from(m[2], 'base64') };
}

/** Embute cada imagem uma vez só por documento. */
function embutidor(doc) {
  const cache = new Map();
  return async (dataUrl) => {
    const chave = crypto.createHash('sha1').update(String(dataUrl)).digest('hex');
    if (!cache.has(chave)) {
      const { tipo, bytes } = lerImagemDataUrl(dataUrl);
      cache.set(chave, tipo === 'png' ? doc.embedPng(bytes) : doc.embedJpg(bytes));
    }
    return cache.get(chave);
  };
}

/**
 * Desenha um retângulo "visual" (largura x altura, girado `angulo` graus no
 * sentido anti-horário em torno do centro) e devolve a âncora do canto
 * inferior esquerdo em coordenadas do PDF.
 */
function ancoraGirada(v, cx, cy, largura, altura, angulo) {
  const a = angulo * RAD;
  const ox = cx - (largura / 2) * Math.cos(a) + (altura / 2) * Math.sin(a);
  const oy = cy - (largura / 2) * Math.sin(a) - (altura / 2) * Math.cos(a);
  return v.ponto(ox, oy);
}

/** Centro do bloco numa das 9 posições, respeitando a margem. */
function centroNaPosicao(posicao, v, bw, bh, margem) {
  const [linha, coluna] = {
    'sup-esq': ['sup', 'esq'], 'sup-centro': ['sup', 'centro'], 'sup-dir': ['sup', 'dir'],
    'meio-esq': ['meio', 'esq'], centro: ['meio', 'centro'], 'meio-dir': ['meio', 'dir'],
    'inf-esq': ['inf', 'esq'], 'inf-centro': ['inf', 'centro'], 'inf-dir': ['inf', 'dir'],
  }[posicao] || ['meio', 'centro'];
  const cx = coluna === 'esq' ? margem + bw / 2 : coluna === 'dir' ? v.largura - margem - bw / 2 : v.largura / 2;
  const cy = linha === 'inf' ? margem + bh / 2 : linha === 'sup' ? v.altura - margem - bh / 2 : v.altura / 2;
  return { cx, cy };
}

/* ============================================================
   NUMERAR
   ============================================================ */

async function numerar({ arquivos, opcoes }, ctx) {
  const modelo = opcoes.formato === 'personalizado' ? String(opcoes.modelo || '{n}') : String(opcoes.formato || '{n}');
  if (!modelo.includes('{n}')) throw new ErroUsuario('O texto precisa ter {n} no lugar do número.');
  const tamanho = limitar(opcoes.tamanho, 5, 72, 11);
  const margem = limitar(opcoes.margem, 1, 80, 12) * MM;
  const inicio = Math.round(limitar(opcoes.inicio, 0, 999999, 1));
  const posicao = String(opcoes.posicao || 'inf-centro');
  const cor = pdf.cor(opcoes.cor, '#333333');

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 95, `Numerando ${a.nome}`);
    const doc = await pdf.abrir(a.caminhoPdf);
    const total = doc.getPageCount();
    const alvo = paginas.escolhidas(opcoes.paginas, total);
    if (!alvo.length) throw new ErroUsuario('Nenhuma página dentro do intervalo escolhido.');
    const ultimo = inicio + alvo.length - 1;
    const texto = (numero) => modelo.replace(/\{n\}/g, String(numero)).replace(/\{total\}/g, String(ultimo));
    const { fonte, preparar } = await fonteParaTextos(doc, opcoes.fonte, booleano(opcoes.negrito), alvo.map((_, k) => texto(inicio + k)));

    alvo.forEach((n, k) => {
      const pagina = doc.getPage(n - 1);
      pdf.isolarConteudo(pagina);
      const v = pdf.visao(pagina);
      const t = preparar(texto(inicio + k));
      const largura = fonte.widthOfTextAtSize(t, tamanho);
      const alturaCaps = fonte.heightAtSize(tamanho, { descender: false });
      const { cx, cy } = centroNaPosicao(posicao, v, largura, alturaCaps, margem);
      const p = ancoraGirada(v, cx, cy, largura, alturaCaps, 0);
      pagina.drawText(t, { x: p.x, y: p.y, size: tamanho, font: fonte, color: cor, rotate: degrees(v.rotacao) });
    });

    await ctx.gravar(`${semExtensao(a.nome)} - numerado.pdf`, await pdf.salvar(doc), { paginas: total });
  }
}

/* ============================================================
   MARCA D'ÁGUA
   ============================================================ */

async function marcaDagua({ arquivos, opcoes }, ctx) {
  const ehImagem = opcoes.tipo === 'imagem';
  const texto = String(opcoes.texto || '').trim().slice(0, 120);
  if (!ehImagem && !texto) throw new ErroUsuario('Digite o texto da marca d\'água.');
  if (ehImagem && !opcoes.imagem) throw new ErroUsuario('Escolha a imagem da marca d\'água.');
  const angulo = limitar(opcoes.rotacao, -360, 360, 45);
  const opacidade = limitar(opcoes.opacidade, 1, 100, 25) / 100;
  const tamanho = limitar(opcoes.tamanho, 6, 300, 54);
  const escala = limitar(opcoes.escala, 2, 100, 40) / 100;
  const mosaico = opcoes.disposicao === 'mosaico';
  const porBaixo = opcoes.camada === 'sob';
  const cor = pdf.cor(opcoes.cor, '#d92d20');

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 95, `Aplicando em ${a.nome}`);
    const doc = await pdf.abrir(a.caminhoPdf);
    const total = doc.getPageCount();
    const alvo = paginas.escolhidas(opcoes.paginas, total);

    let fonte = null;
    let t = texto;
    let imagem = null;
    if (ehImagem) {
      imagem = await embutidor(doc)(opcoes.imagem);
    } else {
      const f = await fonteParaTextos(doc, 'sans', booleano(opcoes.negrito, true), [texto]);
      fonte = f.fonte;
      t = f.preparar(texto);
    }

    for (const n of alvo) {
      const pagina = doc.getPage(n - 1);
      const v = pdf.visao(pagina);
      // tamanho do bloco antes de girar
      let bl;
      let ba;
      if (ehImagem) {
        bl = v.largura * escala;
        ba = bl * (imagem.height / imagem.width);
      } else {
        bl = fonte.widthOfTextAtSize(t, tamanho);
        ba = fonte.heightAtSize(tamanho, { descender: false });
      }
      const ang = angulo * RAD;
      const caixaL = Math.abs(bl * Math.cos(ang)) + Math.abs(ba * Math.sin(ang));
      const caixaA = Math.abs(bl * Math.sin(ang)) + Math.abs(ba * Math.cos(ang));

      const centros = [];
      if (mosaico) {
        const passoX = caixaL + Math.max(ba * 2.2, 40);
        const passoY = caixaA + Math.max(ba * 2.2, 40);
        let linha = 0;
        for (let y = passoY / 2; y < v.altura + passoY; y += passoY, linha += 1) {
          const desloc = linha % 2 ? passoX / 2 : 0;
          for (let x = desloc - passoX / 2; x < v.largura + passoX; x += passoX) centros.push({ cx: x, cy: y });
        }
      } else {
        centros.push(centroNaPosicao(opcoes.posicao || 'centro', v, caixaL, caixaA, 36));
      }

      const desenhar = () => {
        for (const { cx, cy } of centros) {
          const p = ancoraGirada(v, cx, cy, bl, ba, angulo);
          const rotate = degrees(v.rotacao + angulo);
          if (ehImagem) pagina.drawImage(imagem, { x: p.x, y: p.y, width: bl, height: ba, rotate, opacity: opacidade });
          else pagina.drawText(t, { x: p.x, y: p.y, size: tamanho, font: fonte, color: cor, rotate, opacity: opacidade });
        }
      };
      if (porBaixo) pdf.desenharPorBaixo(pagina, desenhar);
      else { pdf.isolarConteudo(pagina); desenhar(); }
    }

    await ctx.gravar(`${semExtensao(a.nome)} - marca dagua.pdf`, await pdf.salvar(doc), { paginas: total });
  }
}

/* ============================================================
   EDITAR / ASSINAR (elementos posicionados na página)
   ============================================================ */

/**
 * elemento: { tipo: 'imagem'|'texto'|'retangulo', pagina, todas?, x, y, w, h (0..1, canto sup. esq.),
 *             imagem?, texto?, tamanho?, fonte?, negrito?, cor?, fundo?, borda?, opacidade? }
 */
async function aplicarElementos({ arquivos, opcoes }, ctx, sufixo) {
  const a = arquivos[0];
  const elementos = Array.isArray(opcoes.elementos) ? opcoes.elementos : [];
  if (!elementos.length) throw new ErroUsuario('Nada para colocar na página.');
  ctx.progresso(10, 'Abrindo o documento...');
  const doc = await pdf.abrir(a.caminhoPdf);
  const total = doc.getPageCount();
  const embutir = embutidor(doc);

  const textos = elementos.filter((e) => e.tipo === 'texto');
  const fontes = new Map();
  for (const e of textos) {
    const chave = `${e.fonte || 'sans'}|${e.negrito ? 1 : 0}`;
    if (!fontes.has(chave)) {
      const todos = textos.filter((x) => `${x.fonte || 'sans'}|${x.negrito ? 1 : 0}` === chave).map((x) => String(x.texto || ''));
      fontes.set(chave, await fonteParaTextos(doc, e.fonte || 'sans', Boolean(e.negrito), todos));
    }
  }

  for (let i = 0; i < elementos.length; i += 1) {
    ctx.checar();
    const e = elementos[i];
    ctx.progresso(15 + (i / elementos.length) * 75, 'Aplicando...');
    const alvos = e.todas ? Array.from({ length: total }, (_, k) => k + 1) : [Number(e.pagina) || 1];
    for (const n of alvos) {
      if (n < 1 || n > total) continue;
      const pagina = doc.getPage(n - 1);
      pdf.isolarConteudo(pagina);
      const v = pdf.visao(pagina);
      const caixa = pdf.caixaNormalizada(v, e);
      const rotate = degrees(v.rotacao);
      const opacity = e.opacidade != null ? limitar(e.opacidade, 0.02, 1, 1) : undefined;

      if (e.tipo === 'imagem') {
        const img = await embutir(e.imagem);
        const p = v.ponto(caixa.x, caixa.y);
        pagina.drawImage(img, { x: p.x, y: p.y, width: caixa.largura, height: caixa.altura, rotate, opacity });
      } else if (e.tipo === 'retangulo') {
        const p = v.ponto(caixa.x, caixa.y);
        pagina.drawRectangle({
          x: p.x, y: p.y, width: caixa.largura, height: caixa.altura, rotate,
          color: e.fundo ? pdf.cor(e.fundo) : undefined,
          opacity,
          borderColor: e.borda ? pdf.cor(e.borda) : undefined,
          borderWidth: e.borda ? limitar(e.espessura, 0.5, 20, 1.5) : 0,
          borderOpacity: opacity,
        });
      } else if (e.tipo === 'texto') {
        const { fonte, preparar } = fontes.get(`${e.fonte || 'sans'}|${e.negrito ? 1 : 0}`);
        const tamanho = limitar(e.tamanho, 4, 200, 14);
        const linhas = String(e.texto || '').split(/\r?\n/).map(preparar);
        const altLinha = tamanho * 1.2;
        const topo = caixa.y + caixa.altura; // y visual do topo da caixa
        if (e.fundo) {
          const p = v.ponto(caixa.x, caixa.y);
          pagina.drawRectangle({ x: p.x, y: p.y, width: caixa.largura, height: caixa.altura, rotate, color: pdf.cor(e.fundo) });
        }
        linhas.forEach((linha, k) => {
          if (!linha) return;
          const base = topo - fonte.heightAtSize(tamanho, { descender: false }) - k * altLinha - (altLinha - tamanho) / 2;
          const p = v.ponto(caixa.x, base);
          pagina.drawText(linha, { x: p.x, y: p.y, size: tamanho, font: fonte, color: pdf.cor(e.cor, '#111111'), rotate, opacity });
        });
      }
    }
  }

  ctx.progresso(95, 'Salvando...');
  await ctx.gravar(`${semExtensao(a.nome)} - ${sufixo}.pdf`, await pdf.salvar(doc), { paginas: total });
}

/* ============================================================
   RECORTAR
   ============================================================ */

async function recortar({ arquivos, opcoes }, ctx) {
  const r = opcoes.recorte;
  if (!r || !(r.w > 0.02) || !(r.h > 0.02)) throw new ErroUsuario('Desenhe a área que deve ficar.');
  const a = arquivos[0];
  const doc = await pdf.abrir(a.caminhoPdf);
  const total = doc.getPageCount();
  const alvo = opcoes.aplicarEm === 'esta' ? [Number(r.pagina) || 1] : Array.from({ length: total }, (_, k) => k + 1);

  for (const n of alvo) {
    const pagina = doc.getPage(n - 1);
    const v = pdf.visao(pagina);
    const c = pdf.caixaNormalizada(v, {
      x: limitar(r.x, 0, 1, 0), y: limitar(r.y, 0, 1, 0), w: limitar(r.w, 0.01, 1, 1), h: limitar(r.h, 0.01, 1, 1),
    });
    const p1 = v.ponto(c.x, c.y);
    const p2 = v.ponto(c.x + c.largura, c.y + c.altura);
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const l = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    pagina.setMediaBox(x, y, l, h);
    pagina.setCropBox(x, y, l, h);
    for (const caixa of ['TrimBox', 'BleedBox', 'ArtBox']) pagina.node.delete(PDFName.of(caixa));
  }
  ctx.progresso(90, 'Salvando...');
  await ctx.gravar(`${semExtensao(a.nome)} - recortado.pdf`, await pdf.salvar(doc), { paginas: total });
}

/* ============================================================
   PROPRIEDADES (metadados)
   ============================================================ */

async function metadados({ arquivos, opcoes }, ctx) {
  const a = arquivos[0];
  const doc = await pdf.abrir(a.caminhoPdf);
  if (booleano(opcoes.limpar)) {
    // apaga o dicionário Info e o XMP: nada de autor, programa, datas...
    const info = doc.context.trailerInfo.Info;
    if (info) {
      doc.context.trailerInfo.Info = undefined;
      if (info instanceof PDFRef) doc.context.delete(info);
    }
    doc.catalog.delete(PDFName.of('Metadata'));
    doc.catalog.delete(PDFName.of('PieceInfo'));
  } else {
    const texto = (v) => String(v == null ? '' : v).slice(0, 1000);
    doc.setTitle(texto(opcoes.titulo), { showInWindowTitleBar: Boolean(opcoes.titulo) });
    doc.setAuthor(texto(opcoes.autor));
    doc.setSubject(texto(opcoes.assunto));
    doc.setKeywords(texto(opcoes.palavrasChave).split(/[,;]/).map((s) => s.trim()).filter(Boolean));
    doc.setCreator(texto(opcoes.criador));
    doc.setProducer(texto(opcoes.produtor));
    doc.setModificationDate(new Date());
    // o XMP antigo contradiria os novos valores: sai
    doc.catalog.delete(PDFName.of('Metadata'));
  }
  ctx.progresso(90, 'Salvando...');
  await ctx.gravar(a.nome.toLowerCase().endsWith('.pdf') ? a.nome : `${semExtensao(a.nome)}.pdf`, await pdf.salvar(doc), { paginas: doc.getPageCount() });
}

/* ============================================================
   ACHATAR (formulários e anotações viram parte da página)
   ============================================================ */

const NAO_ACHATAR = new Set(['Link', 'Popup', 'Widget']);

function numeros(arr, padrao) {
  if (!(arr instanceof PDFArray)) return padrao;
  return arr.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0));
}

/** Desenha a aparência de uma anotação no conteúdo da página. */
function carimbarAnotacao(doc, pagina, anot) {
  const ctx = doc.context;
  const ap = anot.lookupMaybe(PDFName.of('AP'), PDFDict);
  if (!ap) return false;
  let normal = ap.get(PDFName.of('N'));
  let fluxo = ctx.lookup(normal);
  if (fluxo instanceof PDFDict && !(fluxo instanceof PDFStream)) {
    const estado = anot.get(PDFName.of('AS'));
    normal = estado ? fluxo.get(estado) : null;
    fluxo = normal ? ctx.lookup(normal) : null;
  }
  if (!(fluxo instanceof PDFStream) || !(normal instanceof PDFRef)) return false;

  const flags = (anot.lookupMaybe(PDFName.of('F'), PDFNumber) || PDFNumber.of(0)).asNumber();
  if (flags & 2 || flags & 32) return true; // escondida / sem visualização: só some

  const rect = numeros(anot.lookup(PDFName.of('Rect')), null);
  if (!rect) return false;
  const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const bbox = numeros(fluxo.dict.lookup(PDFName.of('BBox')), [0, 0, rx1 - rx0, ry1 - ry0]);
  const m = numeros(fluxo.dict.lookup(PDFName.of('Matrix')), [1, 0, 0, 1, 0, 0]);
  const cantos = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const bx0 = Math.min(...cantos.map((c) => c[0]));
  const by0 = Math.min(...cantos.map((c) => c[1]));
  const bx1 = Math.max(...cantos.map((c) => c[0]));
  const by1 = Math.max(...cantos.map((c) => c[1]));
  if (bx1 - bx0 <= 0 || by1 - by0 <= 0) return false;
  const sx = (rx1 - rx0) / (bx1 - bx0);
  const sy = (ry1 - ry0) / (by1 - by0);

  if (!fluxo.dict.has(PDFName.of('Subtype'))) fluxo.dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  if (!fluxo.dict.has(PDFName.of('Type'))) fluxo.dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  const nome = pagina.node.newXObject('Anot', normal);
  pagina.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy),
    drawObject(nome),
    popGraphicsState(),
  );
  return true;
}

async function achatar({ arquivos }, ctx) {
  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 90, `Achatando ${a.nome}`);
    const doc = await pdf.abrir(a.caminhoPdf);
    let campos = 0;
    let anotacoes = 0;

    try {
      const form = doc.getForm();
      campos = form.getFields().length;
      if (campos) {
        try { form.updateFieldAppearances(); } catch (_) { /* usa a aparência existente */ }
        form.flatten({ updateFieldAppearances: false });
      }
    } catch (err) {
      ctx.aviso(`Alguns campos de "${a.nome}" não puderam ser fixados.`);
    }

    for (const pagina of doc.getPages()) {
      const lista = pagina.node.Annots();
      if (!lista) continue;
      const ficam = [];
      for (let k = 0; k < lista.size(); k += 1) {
        const ref = lista.get(k);
        const anot = doc.context.lookup(ref);
        if (!(anot instanceof PDFDict)) continue;
        const tipo = anot.lookupMaybe(PDFName.of('Subtype'), PDFName);
        const nomeTipo = tipo ? tipo.decodeText() : '';
        if (NAO_ACHATAR.has(nomeTipo)) { ficam.push(ref); continue; }
        pdf.isolarConteudo(pagina);
        if (carimbarAnotacao(doc, pagina, anot)) anotacoes += 1;
        else ficam.push(ref);
      }
      if (ficam.length !== lista.size()) {
        pagina.node.set(PDFName.of('Annots'), doc.context.obj(ficam));
      }
    }

    if (!campos && !anotacoes) ctx.aviso(`"${a.nome}" não tinha formulário nem anotações para achatar; saiu igual.`);
    await ctx.gravar(`${semExtensao(a.nome)} - achatado.pdf`, await pdf.salvar(doc), { paginas: doc.getPageCount() });
  }
}

/* ---------------- registro ---------------- */

registrar('numerar', { executar: numerar });
registrar('marca-dagua', { executar: marcaDagua });
registrar('editar', { executar: (e, c) => aplicarElementos(e, c, 'editado'), max: 1 });
registrar('assinar', { executar: (e, c) => aplicarElementos(e, c, 'assinado'), max: 1 });
registrar('recortar', { executar: recortar, max: 1 });
registrar('metadados', { executar: metadados, max: 1 });
registrar('achatar', { executar: achatar });

module.exports = { numerar, marcaDagua, aplicarElementos, recortar, metadados, achatar };
