'use strict';

/**
 * Comparar duas versões de um documento: o que entrou, o que saiu e o que
 * mudou dentro de cada linha. Gera os dados para a tela e um relatório PDF.
 */

const texto = require('../motores/texto');
const pdf = require('../nucleo/pdf');
const { fonteParaTextos } = require('../nucleo/fontes');
const { semExtensao, ErroUsuario } = require('../nucleo/util');
const { registrar } = require('./index');

/* ============================================================
   DIFERENÇA (Myers)
   ============================================================ */

/**
 * Menor sequência de inserções e remoções entre a e b.
 * @returns {{t:'='|'-'|'+', i?:number, j?:number}[]} ou null se as listas forem diferentes demais
 */
function myers(a, b, limiteD = 4000) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const desloc = max;
  const v = new Int32Array(2 * max + 2);
  const trilha = [];
  for (let d = 0; d <= Math.min(max, limiteD); d += 1) {
    trilha.push(v.slice(desloc - d, desloc + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[desloc + k - 1] < v[desloc + k + 1]) ? v[desloc + k + 1] : v[desloc + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[desloc + k] = x;
      if (x >= n && y >= m) return voltar(trilha, a, b, d);
    }
  }
  return null;
}

function voltar(trilha, a, b, dFinal) {
  const saida = [];
  let x = a.length;
  let y = b.length;
  for (let d = dFinal; d > 0; d -= 1) {
    const v = trilha[d];
    const k = x - y;
    const em = (kk) => v[kk + d]; // trilha[d] guarda v[-d .. d+1]
    const veioDeCima = k === -d || (k !== d && em(k - 1) < em(k + 1));
    const kAnt = veioDeCima ? k + 1 : k - 1;
    const xAnt = em(kAnt);
    const yAnt = xAnt - kAnt;
    while (x > xAnt && y > yAnt) { x -= 1; y -= 1; saida.push({ t: '=', i: x, j: y }); }
    if (veioDeCima) { y -= 1; saida.push({ t: '+', j: y }); } else { x -= 1; saida.push({ t: '-', i: x }); }
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; saida.push({ t: '=', i: x, j: y }); }
  return saida.reverse();
}

/** Diferença palavra a palavra entre duas linhas parecidas. */
function partesDaLinha(antes, depois) {
  const pa = antes.split(/(\s+)/).filter((s) => s.length);
  const pb = depois.split(/(\s+)/).filter((s) => s.length);
  const ops = myers(pa, pb, 400);
  if (!ops) return null;
  const partes = [];
  for (const o of ops) {
    const s = o.t === '+' ? pb[o.j] : pa[o.i];
    const ult = partes[partes.length - 1];
    if (ult && ult.t === o.t) ult.s += s;
    else partes.push({ t: o.t, s });
  }
  return partes;
}

function semelhanca(a, b) {
  const sa = new Set(a.toLowerCase().split(/\s+/));
  const sb = new Set(b.toLowerCase().split(/\s+/));
  let comum = 0;
  for (const p of sa) if (sb.has(p)) comum += 1;
  return comum / Math.max(sa.size, sb.size, 1);
}

/* ============================================================
   FERRAMENTA
   ============================================================ */

async function linhasDoDocumento(caminho, ctx, faixa) {
  const lido = await texto.lerDocumento(caminho, {
    checar: ctx.checar,
    aoProgredir: (f) => ctx.progresso(faixa[0] + f * (faixa[1] - faixa[0]), 'Lendo os documentos...'),
  });
  const linhas = [];
  for (const p of lido.paginas) {
    for (const l of p.linhas) {
      const t = l.texto.replace(/\s+/g, ' ').trim();
      if (t) linhas.push({ texto: t, pagina: p.numero });
    }
  }
  return { linhas, paginas: lido.total };
}

const CONTEXTO = 2;

async function comparar({ arquivos }, ctx) {
  if (arquivos.length !== 2) throw new ErroUsuario('Escolha exatamente dois PDFs: a versão antiga e a nova.');
  const [A, B] = arquivos;
  const da = await linhasDoDocumento(A.caminhoPdf, ctx, [2, 30]);
  const db = await linhasDoDocumento(B.caminhoPdf, ctx, [30, 58]);
  if (!da.linhas.length && !db.linhas.length) {
    throw new ErroUsuario('Nenhum dos dois PDFs tem texto (parecem digitalizados). Passe os dois no OCR antes de comparar.');
  }

  ctx.progresso(62, 'Comparando...');
  const ta = da.linhas.map((l) => l.texto);
  const tb = db.linhas.map((l) => l.texto);
  let ops = myers(ta, tb);
  if (!ops) {
    // diferentes demais para o algoritmo fino: compara em bloco
    ops = [...ta.map((_, i) => ({ t: '-', i })), ...tb.map((_, j) => ({ t: '+', j }))];
    ctx.aviso('Os documentos são muito diferentes entre si; a comparação foi feita em bloco.');
  }

  // monta as linhas, emparelhando remoções e inserções vizinhas como "alteradas"
  const linhas = [];
  for (let k = 0; k < ops.length; k += 1) {
    const o = ops[k];
    if (o.t === '=') {
      linhas.push({ t: '=', texto: ta[o.i], pa: da.linhas[o.i].pagina, pb: db.linhas[o.j].pagina });
      continue;
    }
    // bloco de mudanças contíguas
    const fora = [];
    const dentro = [];
    while (k < ops.length && ops[k].t !== '=') {
      if (ops[k].t === '-') fora.push(ops[k].i); else dentro.push(ops[k].j);
      k += 1;
    }
    k -= 1;
    const pares = Math.min(fora.length, dentro.length);
    for (let p = 0; p < Math.max(fora.length, dentro.length); p += 1) {
      const i = fora[p];
      const j = dentro[p];
      if (p < pares && semelhanca(ta[i], tb[j]) >= 0.35) {
        linhas.push({ t: '~', antes: ta[i], texto: tb[j], pa: da.linhas[i].pagina, pb: db.linhas[j].pagina, partes: partesDaLinha(ta[i], tb[j]) });
      } else {
        if (i !== undefined) linhas.push({ t: '-', texto: ta[i], pa: da.linhas[i].pagina });
        if (j !== undefined) linhas.push({ t: '+', texto: tb[j], pb: db.linhas[j].pagina });
      }
    }
  }

  const resumo = {
    iguais: linhas.filter((l) => l.t === '=').length,
    removidas: linhas.filter((l) => l.t === '-').length,
    adicionadas: linhas.filter((l) => l.t === '+').length,
    alteradas: linhas.filter((l) => l.t === '~').length,
  };

  // Para a tela: só as mudanças com um pouco de contexto em volta.
  const mostrar = new Array(linhas.length).fill(false);
  linhas.forEach((l, idx) => {
    if (l.t !== '=') for (let c = idx - CONTEXTO; c <= idx + CONTEXTO; c += 1) if (c >= 0 && c < linhas.length) mostrar[c] = true;
  });
  const vista = [];
  let pulo = 0;
  linhas.forEach((l, idx) => {
    if (mostrar[idx]) {
      if (pulo) { vista.push({ t: 'pulo', n: pulo }); pulo = 0; }
      vista.push(l);
    } else pulo += 1;
  });
  if (pulo) vista.push({ t: 'pulo', n: pulo });

  ctx.dados({
    a: { nome: A.nome, paginas: da.paginas },
    b: { nome: B.nome, paginas: db.paginas },
    resumo,
    linhas: vista.slice(0, 6000),
    cortado: vista.length > 6000,
  });

  ctx.progresso(80, 'Gerando o relatório...');
  const relatorio = await relatorioPdf(A.nome, B.nome, resumo, vista);
  await ctx.gravar(`Comparação - ${semExtensao(B.nome).slice(0, 60)}.pdf`, relatorio.bytes, { paginas: relatorio.paginas });
}

/* ============================================================
   RELATÓRIO EM PDF
   ============================================================ */

async function relatorioPdf(nomeA, nomeB, resumo, vista) {
  const { rgb } = require('@cantoo/pdf-lib');
  const doc = await pdf.novo();
  doc.setTitle('Comparação de documentos');
  const todos = [nomeA, nomeB, ...vista.map((l) => l.texto || ''), ...vista.map((l) => l.antes || '')];
  const { fonte, preparar } = await fonteParaTextos(doc, 'sans', false, todos);
  const { fonte: negrito, preparar: prepNeg } = await fonteParaTextos(doc, 'sans', true, ['Comparação de documentos', nomeA, nomeB]);
  const [L, H] = [595.28, 841.89];
  const M = 40;
  const largura = L - M * 2 - 46;
  const tam = 9.5;
  const alt = tam * 1.4;
  const CORES = {
    '-': { fundo: rgb(0.99, 0.91, 0.91), texto: rgb(0.55, 0.08, 0.06), sinal: '−' },
    '+': { fundo: rgb(0.9, 0.97, 0.91), texto: rgb(0.05, 0.36, 0.14), sinal: '+' },
    '~': { fundo: rgb(1, 0.97, 0.86), texto: rgb(0.45, 0.3, 0.02), sinal: '±' },
    '=': { fundo: null, texto: rgb(0.3, 0.32, 0.36), sinal: ' ' },
  };

  let pagina = null;
  let y = 0;
  const novaPagina = () => {
    pagina = doc.addPage([L, H]);
    y = H - M;
  };

  const quebrar = (t, f) => {
    const palavras = preparar(t).split(' ');
    const saida = [];
    let atual = '';
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p;
      if (f.widthOfTextAtSize(teste, tam) > largura && atual) { saida.push(atual); atual = p; } else atual = teste;
    }
    if (atual || !saida.length) saida.push(atual);
    return saida;
  };

  novaPagina();
  pagina.drawText(prepNeg('Comparação de documentos'), { x: M, y: y - 16, size: 17, font: negrito, color: rgb(0.08, 0.09, 0.11) });
  y -= 40;
  for (const [rotulo, nome] of [['Versão anterior:', nomeA], ['Versão nova:', nomeB]]) {
    pagina.drawText(rotulo, { x: M, y, size: 10, font: negrito, color: rgb(0.3, 0.32, 0.36) });
    pagina.drawText(preparar(nome).slice(0, 90), { x: M + 92, y, size: 10, font: fonte, color: rgb(0.1, 0.1, 0.12) });
    y -= 15;
  }
  y -= 6;
  const resumoTxt = `${resumo.removidas} linha(s) removida(s)   ·   ${resumo.adicionadas} adicionada(s)   ·   ${resumo.alteradas} alterada(s)   ·   ${resumo.iguais} igual(is)`;
  pagina.drawText(preparar(resumoTxt), { x: M, y, size: 10, font: fonte, color: rgb(0.3, 0.32, 0.36) });
  y -= 24;

  if (!resumo.removidas && !resumo.adicionadas && !resumo.alteradas) {
    pagina.drawText(preparar('Os textos dos dois documentos são iguais.'), { x: M, y, size: 12, font: negrito, color: rgb(0.05, 0.36, 0.14) });
  }

  for (const l of vista) {
    if (l.t === 'pulo') {
      if (y < M + alt * 2) novaPagina();
      pagina.drawText(preparar(`… ${l.n} linha(s) iguais …`), { x: M + 46, y: y - tam, size: tam - 1, font: fonte, color: rgb(0.55, 0.57, 0.6) });
      y -= alt * 1.3;
      continue;
    }
    const c = CORES[l.t] || CORES['='];
    const blocos = l.t === '~'
      ? [['Antes:', quebrar(l.antes, fonte)], ['Depois:', quebrar(l.texto, fonte)]]
      : [[null, quebrar(l.texto, fonte)]];
    const linhasTotal = blocos.reduce((s, b) => s + b[1].length, 0);
    const altura = linhasTotal * alt + 6;
    if (y - altura < M) novaPagina();
    if (c.fundo) pagina.drawRectangle({ x: M, y: y - altura + 2, width: L - M * 2, height: altura, color: c.fundo });
    const ref = l.t === '-' ? `p.${l.pa}` : l.pb ? `p.${l.pb}` : l.pa ? `p.${l.pa}` : '';
    pagina.drawText(ref, { x: M + 4, y: y - tam - 1, size: 7.5, font: fonte, color: rgb(0.5, 0.52, 0.56) });
    pagina.drawText(preparar(c.sinal) || ' ', { x: M + 32, y: y - tam - 1, size: tam + 1, font: negrito, color: c.texto });
    let yy = y - tam - 1;
    for (const [rotulo, partes] of blocos) {
      partes.forEach((linha, idx) => {
        const x0 = M + 46;
        if (rotulo && idx === 0) pagina.drawText(rotulo, { x: x0, y: yy, size: tam - 1.5, font: negrito, color: c.texto });
        pagina.drawText(linha, { x: x0 + (rotulo ? 38 : 0), y: yy, size: tam, font: fonte, color: c.texto });
        yy -= alt;
      });
    }
    y -= altura + 2;
  }

  // rodapé com numeração
  const total = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    p.drawText(`XdPDF · página ${i + 1} de ${total}`, { x: M, y: 20, size: 8, font: fonte, color: rgb(0.6, 0.62, 0.66) });
  });
  return { bytes: await pdf.salvar(doc), paginas: total };
}

registrar('comparar', { executar: comparar, min: 2, max: 2 });

module.exports = { comparar, myers, partesDaLinha };
