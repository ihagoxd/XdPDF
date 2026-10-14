'use strict';

/**
 * Organizar: juntar, dividir, remover, extrair, reordenar e girar páginas.
 */

const { degrees } = require('@cantoo/pdf-lib');
const pdf = require('../nucleo/pdf');
const paginas = require('../nucleo/paginas');
const { semExtensao, nomeSeguro, booleano, limitar, ErroUsuario } = require('../nucleo/util');

const A4 = [595.28, 841.89];

/** Abre cada cópia de trabalho uma vez só, mesmo que apareça várias vezes. */
function abridor() {
  const abertos = new Map();
  return (arquivo) => {
    if (!abertos.has(arquivo.id)) abertos.set(arquivo.id, pdf.abrir(arquivo.caminhoPdf));
    return abertos.get(arquivo.id);
  };
}

function girarMais(pagina, graus) {
  const extra = ((Math.round(Number(graus) / 90) * 90) % 360 + 360) % 360;
  if (!extra) return;
  pagina.setRotation(degrees((pdf.rotacaoDe(pagina) + extra) % 360));
}

/** Copia as páginas (índices 0-based) de um documento para outro. */
async function copiar(destino, origem, indices) {
  const copiadas = await destino.copyPages(origem, indices);
  copiadas.forEach((p) => destino.addPage(p));
  return copiadas;
}

/* ============================================================
   JUNTAR
   ============================================================ */

async function juntar({ arquivos, opcoes }, ctx) {
  if (arquivos.length < 2) throw new ErroUsuario('Adicione pelo menos dois arquivos para juntar.');
  const comMarcadores = booleano(opcoes.marcadores, true);
  const frenteVerso = booleano(opcoes.frenteVerso, false);

  const destino = await pdf.novo();
  const marcadores = [];

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 90, `Juntando ${i + 1} de ${arquivos.length}: ${a.nome}`);
    const origem = await pdf.abrir(a.caminhoPdf);
    const inicio = destino.getPageCount();
    await copiar(destino, origem, origem.getPageIndices());
    marcadores.push({ titulo: semExtensao(a.nome), pagina: inicio });

    // Para imprimir em frente e verso: cada documento começa numa folha nova.
    if (frenteVerso && destino.getPageCount() % 2 === 1 && i < arquivos.length - 1) {
      const ultima = destino.getPage(destino.getPageCount() - 1);
      const { width, height } = ultima.getSize();
      destino.addPage([width, height]);
    }
  }

  if (comMarcadores) pdf.criarMarcadores(destino, marcadores);
  ctx.progresso(95, 'Salvando...');
  const nome = nomeSeguro(opcoes.nome || '', 'Documentos juntados').replace(/\.pdf$/i, '');
  await ctx.gravar(`${nome}.pdf`, await pdf.salvar(destino), { paginas: destino.getPageCount() });
}

/* ============================================================
   DIVIDIR
   ============================================================ */

function rotuloPaginas(lista) {
  if (lista.length === 1) return `pág ${lista[0]}`;
  const texto = paginas.paraTexto(lista);
  return `págs ${texto}`;
}

async function gravarTrecho(ctx, origem, base, lista) {
  const novo = await pdf.novo();
  await copiar(novo, origem, lista.map((n) => n - 1));
  return ctx.gravar(`${base} - ${rotuloPaginas(lista)}.pdf`, await pdf.salvar(novo), { paginas: lista.length });
}

/** Divide em pedaços de no máximo `limite` bytes, sem cortar páginas. */
async function dividirPorTamanho(ctx, origem, base, limite) {
  const total = origem.getPageCount();
  let inicio = 1;
  let parte = 0;

  const tamanhoDe = async (de, ate) => {
    const novo = await pdf.novo();
    await copiar(novo, origem, Array.from({ length: ate - de + 1 }, (_, k) => de - 1 + k));
    const bytes = await pdf.salvar(novo);
    return bytes;
  };

  while (inicio <= total) {
    ctx.checar();
    ctx.progresso(((inicio - 1) / total) * 95, `Medindo páginas a partir da ${inicio}...`);
    // Busca exponencial e depois binária pelo maior trecho que cabe no limite.
    let bom = inicio;
    let bytesBom = await tamanhoDe(inicio, inicio);
    if (bytesBom.length > limite) {
      ctx.aviso(`A página ${inicio} sozinha já passa do limite; ela saiu num arquivo próprio.`);
    } else {
      let passo = 1;
      let ruim = null;
      while (bom + passo <= total) {
        const teste = await tamanhoDe(inicio, bom + passo);
        if (teste.length <= limite) {
          bom += passo;
          bytesBom = teste;
          passo *= 2;
        } else {
          ruim = bom + passo;
          break;
        }
      }
      if (ruim === null && bom < total) ruim = total + 1;
      let baixo = bom;
      let alto = ruim === null ? bom : Math.min(ruim, total + 1);
      while (alto - baixo > 1) {
        const meio = Math.floor((baixo + alto) / 2);
        const teste = await tamanhoDe(inicio, meio);
        if (teste.length <= limite) { baixo = meio; bytesBom = teste; } else alto = meio;
      }
      bom = baixo;
    }
    parte += 1;
    const lista = Array.from({ length: bom - inicio + 1 }, (_, k) => inicio + k);
    await ctx.gravar(`${base} - parte ${parte} (${rotuloPaginas(lista)}).pdf`, bytesBom, { paginas: lista.length });
    inicio = bom + 1;
  }
}

async function dividir({ arquivos, opcoes }, ctx) {
  const modo = String(opcoes.modo || 'intervalos');
  for (const a of arquivos) {
    ctx.checar();
    const origem = await pdf.abrir(a.caminhoPdf);
    const total = origem.getPageCount();
    const base = semExtensao(a.nome);

    if (modo === 'todas') {
      for (let n = 1; n <= total; n += 1) {
        ctx.checar();
        ctx.progresso((n / total) * 95, `Separando página ${n} de ${total}`);
        await gravarTrecho(ctx, origem, base, [n]);
      }
    } else if (modo === 'cada') {
      const n = limitar(opcoes.cada, 1, total, 1);
      for (let ini = 1; ini <= total; ini += n) {
        ctx.checar();
        const lista = Array.from({ length: Math.min(n, total - ini + 1) }, (_, k) => ini + k);
        ctx.progresso((ini / total) * 95, `Separando páginas ${paginas.paraTexto(lista)}`);
        await gravarTrecho(ctx, origem, base, lista);
      }
    } else if (modo === 'tamanho') {
      const mb = limitar(opcoes.mb, 0.1, 2000, 10);
      await dividirPorTamanho(ctx, origem, base, mb * 1024 * 1024);
    } else {
      const grupos = paginas.grupos(opcoes.intervalos, total);
      if (!grupos.length) throw new ErroUsuario('Informe os intervalos, por exemplo: 1-3, 4-8, 9.');
      if (booleano(opcoes.juntarIntervalos, false)) {
        const lista = grupos.flat();
        const novo = await pdf.novo();
        await copiar(novo, origem, lista.map((x) => x - 1));
        await ctx.gravar(`${base} - ${rotuloPaginas(lista)}.pdf`, await pdf.salvar(novo), { paginas: lista.length });
      } else {
        for (let i = 0; i < grupos.length; i += 1) {
          ctx.checar();
          ctx.progresso((i / grupos.length) * 95, `Gerando parte ${i + 1} de ${grupos.length}`);
          await gravarTrecho(ctx, origem, base, grupos[i]);
        }
      }
    }
  }
}

/* ============================================================
   REMOVER / EXTRAIR
   ============================================================ */

function selecaoDoArquivo(opcoes, arquivo) {
  // aceita { [idArquivo]: [páginas] } ou uma seleção única para todos
  if (opcoes.selecao && typeof opcoes.selecao === 'object' && !Array.isArray(opcoes.selecao)) {
    return opcoes.selecao[arquivo.id] || [];
  }
  return opcoes.paginas;
}

async function remover({ arquivos, opcoes }, ctx) {
  for (const a of arquivos) {
    ctx.checar();
    const origem = await pdf.abrir(a.caminhoPdf);
    const total = origem.getPageCount();
    const sel = selecaoDoArquivo(opcoes, a);
    const tirar = new Set(Array.isArray(sel) ? sel.map(Number) : (sel ? Array.from(paginas.conjunto(sel, total)) : []));
    if (!tirar.size) {
      if (arquivos.length === 1) throw new ErroUsuario('Marque as páginas que devem sair.');
      continue;
    }
    let ficam = 0;
    for (let n = 1; n <= total; n += 1) if (!tirar.has(n)) ficam += 1;
    if (!ficam) throw new ErroUsuario(`Não dá para remover todas as páginas de "${a.nome}".`);
    // Remove direto do documento: preserva marcadores, formulários e metadados.
    const indicesTirar = Array.from(tirar).filter((n) => n >= 1 && n <= total).sort((x, y) => y - x);
    for (const n of indicesTirar) origem.removePage(n - 1);
    ctx.progresso(90, 'Salvando...');
    await ctx.gravar(`${semExtensao(a.nome)} - sem ${rotuloPaginas(Array.from(tirar))}.pdf`, await pdf.salvar(origem), { paginas: origem.getPageCount() });
  }
}

async function extrair({ arquivos, opcoes }, ctx) {
  const separadas = booleano(opcoes.separadas, false);
  for (const a of arquivos) {
    ctx.checar();
    const origem = await pdf.abrir(a.caminhoPdf);
    const total = origem.getPageCount();
    const sel = selecaoDoArquivo(opcoes, a);
    const lista = Array.isArray(sel)
      ? Array.from(new Set(sel.map(Number))).filter((n) => n >= 1 && n <= total).sort((x, y) => x - y)
      : Array.from(paginas.conjunto(sel || '', total)).sort((x, y) => x - y);
    if (!lista.length) {
      if (arquivos.length === 1) throw new ErroUsuario('Marque as páginas que devem ser extraídas.');
      continue;
    }
    const base = semExtensao(a.nome);
    if (separadas) {
      for (const n of lista) {
        ctx.checar();
        await gravarTrecho(ctx, origem, base, [n]);
      }
    } else {
      await gravarTrecho(ctx, origem, base, lista);
    }
  }
}

/* ============================================================
   ORGANIZAR (ordem livre, giro, páginas em branco, vários arquivos)
   ============================================================ */

async function organizar({ arquivos, opcoes }, ctx) {
  const lista = Array.isArray(opcoes.paginas) ? opcoes.paginas : [];
  if (!lista.length) throw new ErroUsuario('Nenhuma página ficou no documento.');
  const porId = new Map(arquivos.map((a) => [a.id, a]));
  const abrir = abridor();
  const destino = await pdf.novo();
  let ultimoTamanho = A4;

  for (let i = 0; i < lista.length; i += 1) {
    ctx.checar();
    if (i % 10 === 0) ctx.progresso((i / lista.length) * 90, `Montando página ${i + 1} de ${lista.length}`);
    const item = lista[i] || {};
    if (item.branco) {
      const p = destino.addPage(ultimoTamanho);
      girarMais(p, item.rotacao || 0);
      continue;
    }
    const a = porId.get(item.arquivo);
    if (!a) throw new ErroUsuario('Uma das páginas veio de um arquivo que não está mais na lista.');
    const origem = await abrir(a);
    const indice = Number(item.pagina) - 1;
    if (!Number.isInteger(indice) || indice < 0 || indice >= origem.getPageCount()) {
      throw new ErroUsuario(`A página ${item.pagina} não existe em "${a.nome}".`);
    }
    const [p] = await copiar(destino, origem, [indice]);
    girarMais(p, item.rotacao || 0);
    const { width, height } = p.getSize();
    ultimoTamanho = [width, height];
  }

  ctx.progresso(95, 'Salvando...');
  const base = arquivos.length === 1 ? semExtensao(arquivos[0].nome) : 'Documento organizado';
  const nome = nomeSeguro(opcoes.nome || '', `${base} - organizado`).replace(/\.pdf$/i, '');
  await ctx.gravar(`${nome}.pdf`, await pdf.salvar(destino), { paginas: destino.getPageCount() });
}

/* ============================================================
   GIRAR
   ============================================================ */

async function girar({ arquivos, opcoes }, ctx) {
  const geral = Number(opcoes.graus) || 0;
  const porArquivo = opcoes.rotacoes && typeof opcoes.rotacoes === 'object' ? opcoes.rotacoes : {};

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 90, `Girando ${a.nome}`);
    const doc = await pdf.abrir(a.caminhoPdf);
    const especificas = porArquivo[a.id] || {};
    let mexeu = false;
    doc.getPages().forEach((p, idx) => {
      const graus = especificas[idx + 1] != null ? Number(especificas[idx + 1]) : geral;
      if (((graus % 360) + 360) % 360) { girarMais(p, graus); mexeu = true; }
    });
    if (!mexeu) {
      if (arquivos.length === 1) throw new ErroUsuario('Gire pelo menos uma página antes de salvar.');
      continue;
    }
    await ctx.gravar(`${semExtensao(a.nome)} - girado.pdf`, await pdf.salvar(doc), { paginas: doc.getPageCount() });
  }
}

module.exports = { juntar, dividir, remover, extrair, organizar, girar };
