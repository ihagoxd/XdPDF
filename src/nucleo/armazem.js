'use strict';

/**
 * Registro dos arquivos enviados e dos resultados prontos.
 *
 * Cada arquivo enviado ganha uma "cópia de trabalho" em PDF, sem senha:
 *   - PDF comum: o próprio arquivo;
 *   - PDF com restrições (travado para imprimir/copiar): cópia descriptografada;
 *   - PDF que pede senha: fica aguardando a senha (estado 'senha');
 *   - Word/Excel/PowerPoint: convertido pelo Office;
 *   - imagem: vira uma página A4.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const config = require('../config');
const eventos = require('./eventos');
const pdf = require('./pdf');
const { novoId, nomeSeguro, extensao, ErroUsuario } = require('./util');
const office = require('../motores/office');
const imagens = require('../motores/imagens');

const arquivos = new Map();
const resultados = new Map();

/* ============================================================
   ARQUIVOS DE ENTRADA
   ============================================================ */

function tipoDe(nome) {
  const ext = extensao(nome);
  if (ext === '.pdf') return 'pdf';
  if (imagens.ehImagem(ext)) return 'imagem';
  if (office.programaDe(nome)) return 'office';
  return 'outro';
}

/** O que o navegador pode ver de um arquivo (sem caminhos do disco). */
function publico(a) {
  if (!a) return null;
  return {
    id: a.id,
    nome: a.nome,
    tipo: a.tipo,
    programa: a.programa || null,
    tamanho: a.tamanho,
    estado: a.estado,
    erro: a.erro,
    paginas: a.paginas,
    protegido: a.protegido,
    largura: a.largura,
    altura: a.altura,
    imagem: a.imagem || null,
    origem: a.origem,
    criadoEm: a.criadoEm,
  };
}

function avisar(a) {
  eventos.publicar('arquivo', publico(a));
}

function obter(id) {
  return arquivos.get(id) || null;
}

/** Garante que o arquivo existe e está pronto para as ferramentas de PDF. */
function exigirPronto(id) {
  const a = arquivos.get(id);
  if (!a) throw new ErroUsuario('Um dos arquivos não está mais disponível. Adicione de novo.');
  if (a.estado === 'preparando') throw new ErroUsuario(`"${a.nome}" ainda está sendo preparado. Aguarde um instante.`);
  if (a.estado === 'senha') throw new ErroUsuario(`"${a.nome}" pede senha. Informe a senha antes de continuar.`);
  if (a.estado !== 'pronto' || !a.caminhoPdf) throw new ErroUsuario(`"${a.nome}": ${a.erro || 'arquivo inválido'}.`);
  return a;
}

/**
 * Registra arquivos recém-chegados e começa a prepará-los em segundo plano.
 * @param {{nome:string, caminho:string, tamanho:number, origem?:string}[]} entradas
 */
function registrar(entradas) {
  const novos = entradas.map((e) => {
    const tipo = tipoDe(e.nome);
    const a = {
      id: novoId(),
      nome: e.nome,
      tipo,
      programa: tipo === 'office' ? office.programaDe(e.nome) : null,
      tamanho: e.tamanho || 0,
      caminho: e.caminho,
      caminhoPdf: null,
      estado: tipo === 'outro' ? 'erro' : 'preparando',
      erro: tipo === 'outro' ? 'Formato não suportado' : null,
      paginas: null,
      protegido: false,
      largura: null,
      altura: null,
      origem: e.origem || 'upload',
      criadoEm: Date.now(),
    };
    arquivos.set(a.id, a);
    return a;
  });
  preparar(novos.filter((a) => a.estado === 'preparando')).catch((err) => console.error('[preparar]', err));
  return novos;
}

async function lerPaginas(a, doc) {
  a.paginas = doc.getPageCount();
  if (!a.paginas) throw Object.assign(new Error('O PDF não tem páginas.'), { codigo: 'vazio' });
  const v = pdf.visao(doc.getPage(0));
  a.largura = Math.round(v.largura * 100) / 100;
  a.altura = Math.round(v.altura * 100) / 100;
}

async function prepararPdf(a) {
  const bytes = await fsp.readFile(a.caminho);
  try {
    const { doc, criptografado } = await pdf.carregar(bytes);
    await lerPaginas(a, doc);
    if (criptografado) {
      // PDF travado: guarda uma cópia limpa, que as ferramentas conseguem editar.
      const limpo = path.join(config.pastas.entrada, `${a.id}-limpo.pdf`);
      await fsp.writeFile(limpo, await pdf.salvar(doc));
      a.caminhoPdf = limpo;
      a.protegido = true;
    } else {
      a.caminhoPdf = a.caminho;
    }
    a.estado = 'pronto';
  } catch (err) {
    if (err.codigo === 'senha') {
      a.estado = 'senha';
      a.protegido = true;
      a.erro = 'Protegido por senha';
    } else {
      a.estado = 'erro';
      a.erro = err.codigo === 'nao-pdf' ? 'Não é um PDF válido'
        : err.codigo === 'vazio' ? 'O PDF não tem páginas'
        : 'PDF danificado — tente a ferramenta Reparar PDF';
    }
  }
}

async function prepararImagem(a) {
  try {
    const bytes = await fsp.readFile(a.caminho);
    const info = await imagens.ler(bytes);
    a.imagem = { largura: info.largura, altura: info.altura, formato: info.formato, quadros: info.paginas };
    const preparada = await imagens.paraEmbutir(bytes, { maxPx: 3000, qualidade: 88 });
    const doc = await pdf.PDFDocument.create();
    await imagens.adicionarPagina(doc, preparada, { tamanho: 'a4', orientacao: 'auto', margem: 'nenhuma' });
    const destino = path.join(config.pastas.entrada, `${a.id}-imagem.pdf`);
    await fsp.writeFile(destino, await pdf.salvar(doc));
    a.caminhoPdf = destino;
    await lerPaginas(a, doc);
    a.estado = 'pronto';
  } catch (err) {
    a.estado = 'erro';
    a.erro = err.usuario ? err.message : 'Não foi possível ler esta imagem';
  }
}

async function prepararOffice(lista) {
  const mapa = await office.converter(lista.map((a) => a.caminho));
  await Promise.all(lista.map(async (a) => {
    const r = mapa.get(path.resolve(a.caminho));
    if (r && r.ok) {
      try {
        a.caminhoPdf = r.pdf;
        await lerPaginas(a, await pdf.abrir(r.pdf));
        a.estado = 'pronto';
      } catch (_) {
        a.estado = 'erro';
        a.erro = 'O PDF convertido veio com defeito';
      }
    } else {
      a.estado = 'erro';
      a.erro = (r && r.erro) || 'Não foi possível converter';
    }
    avisar(a);
  }));
}

async function preparar(lista) {
  const doOffice = lista.filter((a) => a.tipo === 'office');
  const outros = lista.filter((a) => a.tipo !== 'office');

  // PDFs e imagens: poucos de cada vez, para não sufocar a máquina com lotes grandes.
  const LOTE = 4;
  for (let i = 0; i < outros.length; i += LOTE) {
    await Promise.all(outros.slice(i, i + LOTE).map(async (a) => {
      if (!arquivos.has(a.id)) return; // removido enquanto esperava
      if (a.tipo === 'pdf') await prepararPdf(a);
      else await prepararImagem(a);
      avisar(a);
    }));
  }
  if (doOffice.length) await prepararOffice(doOffice.filter((a) => arquivos.has(a.id)));
}

/** Tenta abrir um PDF protegido com a senha informada. */
async function desbloquear(id, senha) {
  const a = arquivos.get(id);
  if (!a) throw new ErroUsuario('Arquivo não encontrado.');
  if (a.estado !== 'senha') return publico(a);
  const bytes = await fsp.readFile(a.caminho);
  let resultado;
  try {
    resultado = await pdf.carregar(bytes, { senha: String(senha || '') });
  } catch (err) {
    if (err.codigo === 'senha') throw new ErroUsuario('Senha incorreta. Confira maiúsculas e minúsculas.');
    throw new ErroUsuario('A senha abriu, mas o arquivo está danificado.');
  }
  await lerPaginas(a, resultado.doc);
  const limpo = path.join(config.pastas.entrada, `${a.id}-limpo.pdf`);
  await fsp.writeFile(limpo, await pdf.salvar(resultado.doc));
  a.caminhoPdf = limpo;
  a.estado = 'pronto';
  a.erro = null;
  avisar(a);
  return publico(a);
}

async function apagarArquivosDe(a) {
  const alvos = [a.caminho, a.caminhoPdf].filter((c) => c && c.startsWith(config.pastas.entrada));
  await Promise.all(alvos.map((c) => fsp.rm(c, { force: true }).catch(() => {})));
}

async function remover(ids) {
  let n = 0;
  for (const id of ids) {
    const a = arquivos.get(id);
    if (!a) continue;
    arquivos.delete(id);
    await apagarArquivosDe(a);
    n += 1;
  }
  return n;
}

/* ============================================================
   RESULTADOS
   ============================================================ */

const MIME = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.html': 'text/html; charset=utf-8',
};

function publicoResultado(r) {
  if (!r) return null;
  return {
    id: r.id,
    nome: r.nome,
    tamanho: r.tamanho,
    tipo: r.tipo,
    paginas: r.paginas,
    ferramenta: r.ferramenta,
    tarefa: r.tarefa,
    criadoEm: r.criadoEm,
    original: r.original || null,
  };
}

/**
 * Grava um resultado e devolve o registro.
 * @param {string} nome nome do arquivo final
 * @param {Buffer|Uint8Array} bytes
 * @param {{ferramenta?:string, tarefa?:string, paginas?:number, original?:number}} meta
 */
async function gravarResultado(nome, bytes, meta = {}) {
  const id = novoId();
  const limpo = nomeSeguro(nome);
  const pasta = path.join(config.pastas.saida, id);
  await fsp.mkdir(pasta, { recursive: true });
  const caminho = path.join(pasta, limpo);
  await fsp.writeFile(caminho, bytes);
  const r = {
    id,
    nome: limpo,
    caminho,
    tamanho: bytes.length,
    tipo: MIME[extensao(limpo)] || 'application/octet-stream',
    paginas: meta.paginas || null,
    ferramenta: meta.ferramenta || null,
    tarefa: meta.tarefa || null,
    original: meta.original || null,
    criadoEm: Date.now(),
  };
  resultados.set(id, r);
  salvarHistoricoAdiado();
  return r;
}

function obterResultado(id) {
  return resultados.get(id) || null;
}

function listarResultados(limite = 200) {
  return Array.from(resultados.values())
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, limite)
    .map(publicoResultado);
}

async function removerResultados(ids) {
  let n = 0;
  for (const id of ids) {
    const r = resultados.get(id);
    if (!r) continue;
    resultados.delete(id);
    await fsp.rm(path.dirname(r.caminho), { recursive: true, force: true }).catch(() => {});
    n += 1;
  }
  salvarHistoricoAdiado();
  return n;
}

/** Usa um resultado como entrada de outra ferramenta (continuar o trabalho). */
async function reaproveitar(idResultado) {
  const r = resultados.get(idResultado);
  if (!r) throw new ErroUsuario('Resultado não encontrado.');
  const copia = path.join(config.pastas.entrada, `${novoId()}${extensao(r.nome)}`);
  await fsp.copyFile(r.caminho, copia);
  const [a] = registrar([{ nome: r.nome, caminho: copia, tamanho: r.tamanho, origem: 'resultado' }]);
  return a;
}

/* ---------------- histórico em disco ---------------- */

let timerHistorico = null;

function salvarHistoricoAdiado() {
  clearTimeout(timerHistorico);
  timerHistorico = setTimeout(() => {
    const lista = Array.from(resultados.values()).sort((a, b) => b.criadoEm - a.criadoEm).slice(0, 500);
    fsp.writeFile(config.ARQUIVO_HISTORICO, JSON.stringify(lista), 'utf8').catch(() => {});
  }, 400);
}

function carregarHistorico() {
  try {
    const lista = JSON.parse(fs.readFileSync(config.ARQUIVO_HISTORICO, 'utf8'));
    for (const r of lista) {
      if (r && r.id && r.caminho && fs.existsSync(r.caminho)) resultados.set(r.id, r);
    }
  } catch (_) { /* primeira vez */ }
}

/* ============================================================
   FAXINA
   ============================================================ */

async function faxina({ inicio = false } = {}) {
  const agora = Date.now();

  if (inicio) {
    // Entradas não sobrevivem a um reinício: o registro delas era só em memória.
    await fsp.rm(config.pastas.entrada, { recursive: true, force: true }).catch(() => {});
    await fsp.mkdir(config.pastas.entrada, { recursive: true });
    for (const nome of await fsp.readdir(config.pastas.trabalho).catch(() => [])) {
      if (nome === 'office') continue; // cache de conversões do Office
      await fsp.rm(path.join(config.pastas.trabalho, nome), { recursive: true, force: true }).catch(() => {});
    }
    carregarHistorico();
  }

  const limiteEntrada = agora - config.HORAS_ENTRADA * 3600e3;
  for (const a of Array.from(arquivos.values())) {
    if (a.criadoEm < limiteEntrada) {
      arquivos.delete(a.id);
      await apagarArquivosDe(a);
    }
  }

  const limiteResultado = agora - config.DIAS_RESULTADO * 86400e3;
  const velhos = Array.from(resultados.values()).filter((r) => r.criadoEm < limiteResultado).map((r) => r.id);
  if (velhos.length) await removerResultados(velhos);

  // pastas de resultado órfãs (sem registro)
  for (const nome of await fsp.readdir(config.pastas.saida).catch(() => [])) {
    if (!resultados.has(nome)) {
      await fsp.rm(path.join(config.pastas.saida, nome), { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  registrar,
  obter,
  exigirPronto,
  publico,
  desbloquear,
  remover,
  gravarResultado,
  obterResultado,
  listarResultados,
  publicoResultado,
  removerResultados,
  reaproveitar,
  faxina,
  tipoDe,
};
