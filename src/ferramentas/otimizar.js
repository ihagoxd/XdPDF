'use strict';

/**
 * Otimizar: comprimir, reparar e OCR.
 */

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const config = require('../config');
const pdf = require('../nucleo/pdf');
const pdfjs = require('../motores/pdfjs');
const so = require('../motores/so');
const ocr = require('../motores/ocr');
const camada = require('../motores/camada-texto');
const compressao = require('../motores/compressao');
const { semExtensao, booleano, novoId, ErroUsuario } = require('../nucleo/util');
const { registrar } = require('./index');

const execFileAsync = promisify(execFile);

/* ============================================================
   COMPRIMIR
   ============================================================ */

const PERFIS_GS = { extrema: '/screen', recomendada: '/ebook', leve: '/printer' };

/** Ghostscript, quando instalado, às vezes consegue ainda mais. */
async function comGhostscript(caminho, nivel, cinza) {
  const gs = so.acharGhostscript();
  if (!gs) return null;
  const saida = path.join(config.pastas.trabalho, `gs-${novoId()}.pdf`);
  try {
    const args = [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6', `-dPDFSETTINGS=${PERFIS_GS[nivel] || '/ebook'}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH', '-dSAFER', '-dDetectDuplicateImages=true', '-dCompressFonts=true',
      '-dAutoRotatePages=/None',
    ];
    if (cinza) args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
    args.push(`-sOutputFile=${saida}`, caminho);
    await execFileAsync(gs, args, { timeout: 600000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return await fsp.readFile(saida);
  } catch (_) {
    return null;
  } finally {
    fsp.rm(saida, { force: true }).catch(() => {});
  }
}

async function comprimir({ arquivos, opcoes }, ctx) {
  const nivel = compressao.NIVEIS[opcoes.nivel] ? opcoes.nivel : 'recomendada';
  const cinza = booleano(opcoes.tonsCinza);
  let semGanho = 0;

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    const parte = (x) => ((i + x) / arquivos.length) * 100;
    ctx.progresso(parte(0.02), `Lendo ${a.nome}`);
    const original = await fsp.readFile(a.caminhoPdf);
    const doc = await pdf.abrir(a.caminhoPdf);

    await compressao.recomprimirImagens(doc, nivel, {
      cinza,
      checar: ctx.checar,
      aoProgredir: (f, texto) => ctx.progresso(parte(0.05 + f * 0.75), arquivos.length > 1 ? `${a.nome}: ${texto.toLowerCase()}` : texto),
    });
    compressao.comprimirFluxosSoltos(doc);
    await doc.flush();
    pdf.coletarLixo(doc);
    ctx.progresso(parte(0.85), 'Salvando...');
    let melhor = await pdf.salvar(doc);

    const gs = await comGhostscript(a.caminhoPdf, nivel, cinza);
    if (gs && gs.length < melhor.length) melhor = gs;

    // nunca entrega um arquivo maior que o original
    if (melhor.length >= original.length) {
      melhor = original;
      semGanho += 1;
    }
    await ctx.gravar(`${semExtensao(a.nome)} - comprimido.pdf`, melhor, { paginas: a.paginas, original: original.length });
  }
  if (semGanho) {
    ctx.aviso(semGanho === arquivos.length
      ? 'O PDF já estava bem otimizado (texto e vetores ocupam pouco). Não havia imagens pesadas para reduzir.'
      : `${semGanho} arquivo(s) já estavam otimizados e saíram iguais.`);
  }
}

/* ============================================================
   REPARAR
   ============================================================ */

/** Último recurso: o pdf.js reconstrói o que dá e cada página vira imagem. */
async function recuperarComoImagem(bytes, ctx) {
  const leitor = await pdfjs.abrir(bytes);
  try {
    const doc = await pdf.novo();
    for (let n = 1; n <= leitor.numPages; n += 1) {
      ctx.checar();
      ctx.progresso(30 + (n / leitor.numPages) * 60, `Recuperando a página ${n} de ${leitor.numPages}`);
      try {
        const d = await pdfjs.desenhar(leitor, n, { dpi: 170, qualidade: 85 });
        const img = await doc.embedJpg(d.bytes);
        doc.addPage([d.larguraPt, d.alturaPt]).drawImage(img, { x: 0, y: 0, width: d.larguraPt, height: d.alturaPt });
      } catch (_) {
        ctx.aviso(`A página ${n} estava perdida e ficou de fora.`);
      }
    }
    if (!doc.getPageCount()) return null;
    return doc;
  } finally {
    leitor.destroy();
  }
}

async function confereComPdfjs(bytes, paginasEsperadas) {
  try {
    const leitor = await pdfjs.abrir(bytes);
    const ok = leitor.numPages === paginasEsperadas;
    if (ok) await (await leitor.getPage(1)).getOperatorList();
    leitor.destroy();
    return ok;
  } catch (_) {
    return false;
  }
}

async function reparar({ arquivos }, ctx) {
  for (const a of arquivos) {
    ctx.checar();
    if (a.estado === 'senha') throw new ErroUsuario(`"${a.nome}" pede senha. Digite a senha antes de reparar.`);
    ctx.progresso(5, `Analisando ${a.nome}`);
    const bytes = await fsp.readFile(a.caminho);
    const base = semExtensao(a.nome);

    // 1) reconstrução da estrutura (mantém texto e qualidade)
    let saida = null;
    try {
      const { doc } = await pdf.carregar(bytes);
      if (doc.getPageCount() > 0) {
        ctx.progresso(20, 'Reconstruindo a estrutura...');
        const novo = await pdf.novo();
        const copiadas = await novo.copyPages(doc, doc.getPageIndices());
        copiadas.forEach((p) => novo.addPage(p));
        const candidato = await pdf.salvar(novo);
        if (await confereComPdfjs(candidato, novo.getPageCount())) saida = candidato;
      }
    } catch (err) {
      if (err.codigo === 'senha') throw new ErroUsuario(`"${a.nome}" pede senha.`);
    }

    if (saida) {
      await ctx.gravar(`${base} - reparado.pdf`, saida, { original: bytes.length });
      continue;
    }

    // 2) recuperação visual
    ctx.progresso(25, 'A estrutura está muito danificada; recuperando o que aparece nas páginas...');
    let doc = null;
    try {
      doc = await recuperarComoImagem(bytes, ctx);
    } catch (_) {
      doc = null;
    }
    if (!doc) throw new ErroUsuario(`Não foi possível recuperar nada de "${a.nome}". O arquivo está danificado demais.`);
    ctx.aviso('O arquivo estava muito danificado: as páginas foram recuperadas como imagem. Use o OCR para voltar a pesquisar o texto.');
    await ctx.gravar(`${base} - reparado.pdf`, await pdf.salvar(doc), { paginas: doc.getPageCount(), original: bytes.length });
  }
}

/* ============================================================
   OCR
   ============================================================ */

async function reconhecerTexto({ arquivos, opcoes }, ctx) {
  const idioma = ocr.normalizarIdioma(opcoes.idioma);
  const pular = booleano(opcoes.pularComTexto, true);
  let jaTinham = 0;

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    const doc = await pdf.abrir(a.caminhoPdf);
    const leitor = await pdfjs.abrir(a.caminhoPdf);
    const total = leitor.numPages;
    let lidas = 0;
    try {
      for (let n = 1; n <= total; n += 1) {
        ctx.checar();
        const fatia = (i + (n - 1) / total) / arquivos.length;
        ctx.progresso(2 + fatia * 95, arquivos.length > 1 ? `${a.nome}: página ${n} de ${total}` : `Lendo a página ${n} de ${total}...`);
        if (pular) {
          const { itens } = await pdfjs.textoDaPagina(leitor, n);
          const letras = itens.reduce((s, it) => s + it.texto.replace(/\s/g, '').length, 0);
          if (letras > 40) continue;
        }
        if (n === 1 && i === 0) ctx.progresso(2, 'Preparando o reconhecimento de texto...');
        const imagem = await pdfjs.desenhar(leitor, n, { dpi: 260, qualidade: 92 });
        const lido = await ocr.reconhecer(imagem.bytes, idioma);
        await camada.escrever(doc, doc.getPage(n - 1), lido, imagem.escala);
        lidas += 1;
      }
    } finally {
      leitor.destroy();
    }
    if (!lidas) jaTinham += 1;
    await ctx.gravar(`${semExtensao(a.nome)} - pesquisavel.pdf`, await pdf.salvar(doc), { paginas: total });
  }
  if (jaTinham) {
    ctx.aviso(jaTinham === arquivos.length
      ? 'Todas as páginas já tinham texto selecionável; nada precisou ser reconhecido.'
      : `${jaTinham} arquivo(s) já tinham texto em todas as páginas.`);
  }
}

registrar('comprimir', { executar: comprimir });
registrar('reparar', { executar: reparar, entrada: 'bruto' });
registrar('ocr', { executar: reconhecerTexto });

module.exports = { comprimir, reparar, reconhecerTexto };
