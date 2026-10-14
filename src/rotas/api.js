'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const config = require('../config');
const armazem = require('../nucleo/armazem');
const eventos = require('../nucleo/eventos');
const tarefas = require('../nucleo/tarefas');
const configuracao = require('../nucleo/configuracao');
const assinaturas = require('../nucleo/assinaturas');
const { escreverZip } = require('../nucleo/zip');
const { novoId, extensao, corrigirNomeUpload, nomesUnicos, nomeSeguro, ErroUsuario } = require('../nucleo/util');
const ferramentas = require('../ferramentas');
const sistema = require('../nucleo/sistema');
const so = require('../motores/so');

const router = express.Router();

/** Handlers async: erro vira resposta, não derruba o processo. */
function seguro(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Algumas ações mexem no computador (abrir pasta): só para quem está na própria máquina. */
function ehLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/* ============================================================
   SISTEMA E EVENTOS
   ============================================================ */

router.get('/sistema', seguro(async (req, res) => {
  res.json({
    ok: true,
    versao: config.VERSAO,
    modoApp: config.MODO_APP,
    local: ehLocal(req),
    capacidades: await sistema.capacidades(),
    config: configuracao.ler(),
  });
}));

router.get('/eventos', (req, res) => eventos.conectar(req, res));

router.get('/config', (req, res) => res.json({ ok: true, config: configuracao.ler() }));

router.put('/config', (req, res) => {
  res.json({ ok: true, config: configuracao.salvar(req.body || {}) });
});

/* ============================================================
   ARQUIVOS DE ENTRADA
   ============================================================ */

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.pastas.entrada),
    filename(req, file, cb) {
      file.originalname = corrigirNomeUpload(file.originalname);
      cb(null, `${novoId()}${extensao(file.originalname) || '.bin'}`);
    },
  }),
  limits: { fileSize: config.LIMITE_ARQUIVO_MB * 1024 * 1024, files: config.LIMITE_ARQUIVOS, fields: 20 },
});

router.post('/arquivos', upload.array('arquivos', config.LIMITE_ARQUIVOS), seguro(async (req, res) => {
  const entradas = (req.files || []).map((f) => ({ nome: f.originalname, caminho: f.path, tamanho: f.size }));
  if (!entradas.length) throw new ErroUsuario('Nenhum arquivo chegou.');
  const novos = armazem.registrar(entradas);
  res.json({ ok: true, arquivos: novos.map(armazem.publico) });
}));

router.get('/arquivos/:id', (req, res) => {
  const a = armazem.obter(req.params.id);
  if (!a) return res.status(404).json({ ok: false, erro: 'Arquivo não encontrado.' });
  res.json({ ok: true, arquivo: armazem.publico(a) });
});

/** A cópia de trabalho em PDF — é o que o navegador usa para mostrar as páginas. */
router.get('/arquivos/:id/pdf', (req, res) => {
  const a = armazem.obter(req.params.id);
  if (!a || !a.caminhoPdf) return res.status(404).type('text/plain').send('Arquivo não está pronto.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(a.caminhoPdf), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

router.get('/arquivos/:id/original', (req, res) => {
  const a = armazem.obter(req.params.id);
  if (!a) return res.status(404).type('text/plain').send('Arquivo não encontrado.');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(a.caminho), { headers: { 'Content-Disposition': 'inline' } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

router.post('/arquivos/:id/senha', seguro(async (req, res) => {
  const arquivo = await armazem.desbloquear(req.params.id, (req.body || {}).senha);
  res.json({ ok: true, arquivo });
}));

router.post('/arquivos/remover', seguro(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  res.json({ ok: true, removidos: await armazem.remover(ids) });
}));

/** Informações extras do PDF (metadados, para a ferramenta de propriedades). */
router.get('/arquivos/:id/info', seguro(async (req, res) => {
  const a = armazem.exigirPronto(req.params.id);
  res.json({ ok: true, info: await sistema.infoPdf(a.caminhoPdf) });
}));

/** Procura texto no PDF e devolve onde está (tarjar automático). */
router.post('/arquivos/:id/localizar', seguro(async (req, res) => {
  const a = armazem.exigirPronto(req.params.id);
  const texto = require('../motores/texto');
  const achados = await texto.localizar(a.caminhoPdf, req.body || {});
  res.json({ ok: true, achados });
}));

/* ============================================================
   FERRAMENTAS E TAREFAS
   ============================================================ */

router.post('/ferramentas/:id', seguro(async (req, res) => {
  const tarefa = ferramentas.executar(req.params.id, req.body || {});
  res.json({ ok: true, tarefa });
}));

router.get('/tarefas/:id', (req, res) => {
  const t = tarefas.obter(req.params.id);
  if (!t) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada.' });
  res.json({ ok: true, tarefa: t });
});

router.post('/tarefas/:id/cancelar', (req, res) => {
  const t = tarefas.cancelar(req.params.id);
  if (!t) return res.status(404).json({ ok: false, erro: 'Tarefa não encontrada.' });
  res.json({ ok: true, tarefa: t });
});

/* ============================================================
   RESULTADOS
   ============================================================ */

router.get('/resultados', (req, res) => {
  res.json({ ok: true, resultados: armazem.listarResultados(Number(req.query.limite) || 200) });
});

router.get('/resultados/zip', seguro(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  const itens = ids.map((id) => armazem.obterResultado(id)).filter(Boolean);
  if (!itens.length) return res.status(404).type('text/plain').send('Nada para baixar.');
  const nomes = nomesUnicos(itens.map((r) => r.nome));
  const nomeZip = `${nomeSeguro(String(req.query.nome || ''), 'XdPDF').replace(/\.zip$/i, '')}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="xdpdf.zip"; filename*=UTF-8''${encodeURIComponent(nomeZip)}`);
  await escreverZip(res, itens.map((r, i) => ({ nome: nomes[i], caminho: r.caminho })));
  res.end();
}));

router.get('/resultados/:id', (req, res) => {
  const r = armazem.obterResultado(req.params.id);
  if (!r) return res.status(404).type('text/plain').send('Este arquivo não existe mais.');
  const modo = req.query.ver === '1' ? 'inline' : 'attachment';
  res.setHeader('Content-Type', r.tipo);
  res.setHeader('Content-Disposition', `${modo}; filename="arquivo${extensao(r.nome)}"; filename*=UTF-8''${encodeURIComponent(r.nome)}`);
  res.sendFile(path.resolve(r.caminho), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

router.post('/resultados/remover', seguro(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  res.json({ ok: true, removidos: await armazem.removerResultados(ids) });
}));

/** Continua o trabalho: o resultado vira entrada de outra ferramenta. */
router.post('/resultados/reaproveitar', seguro(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const arquivos = [];
  for (const id of ids) arquivos.push(armazem.publico(await armazem.reaproveitar(id)));
  res.json({ ok: true, arquivos });
}));

/** Copia para a pasta escolhida e abre o Explorer com o arquivo marcado. */
router.post('/resultados/salvar', seguro(async (req, res) => {
  if (!ehLocal(req)) throw new ErroUsuario('Salvar direto na pasta só funciona no próprio computador. Use Baixar.');
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const itens = ids.map((id) => armazem.obterResultado(id)).filter(Boolean);
  if (!itens.length) throw new ErroUsuario('Nada para salvar.');
  const cfg = configuracao.ler();
  const pasta = String(req.body.pasta || cfg.pastaSaida);
  await fsp.mkdir(pasta, { recursive: true });

  const salvos = [];
  for (const r of itens) {
    let alvo = path.join(pasta, r.nome);
    // não sobrescreve: "nome (2).pdf", "nome (3).pdf"...
    for (let n = 2; fs.existsSync(alvo); n += 1) {
      const ext = path.extname(r.nome);
      alvo = path.join(pasta, `${r.nome.slice(0, r.nome.length - ext.length)} (${n})${ext}`);
    }
    await fsp.copyFile(r.caminho, alvo);
    salvos.push(alvo);
  }
  if (cfg.abrirPastaAoSalvar && req.body.abrir !== false) so.mostrarNaPasta(salvos[0]);
  res.json({ ok: true, pasta, salvos });
}));

router.post('/resultados/:id/abrir', seguro(async (req, res) => {
  if (!ehLocal(req)) throw new ErroUsuario('Só funciona no próprio computador.');
  const r = armazem.obterResultado(req.params.id);
  if (!r) throw new ErroUsuario('Este arquivo não existe mais.');
  await so.abrirArquivo(r.caminho);
  res.json({ ok: true });
}));

router.post('/abrir-pasta', seguro(async (req, res) => {
  if (!ehLocal(req)) throw new ErroUsuario('Só funciona no próprio computador.');
  const pasta = configuracao.ler().pastaSaida;
  await fsp.mkdir(pasta, { recursive: true });
  await so.mostrarNaPasta(pasta);
  res.json({ ok: true });
}));

/* ============================================================
   ASSINATURAS GUARDADAS
   ============================================================ */

router.get('/assinaturas', seguro(async (req, res) => {
  res.json({ ok: true, assinaturas: await assinaturas.listar() });
}));

router.post('/assinaturas', seguro(async (req, res) => {
  res.json({ ok: true, assinatura: await assinaturas.guardar((req.body || {}).imagem, (req.body || {}).tipo) });
}));

router.get('/assinaturas/:id', seguro(async (req, res) => {
  const caminho = assinaturas.caminho(req.params.id);
  if (!caminho) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(caminho);
}));

router.delete('/assinaturas/:id', seguro(async (req, res) => {
  await assinaturas.apagar(req.params.id);
  res.json({ ok: true });
}));

/* ============================================================
   ERROS
   ============================================================ */

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  let mensagem = err && err.usuario ? err.message : null;
  if (!mensagem && err && err.code === 'LIMIT_FILE_SIZE') mensagem = `Arquivo grande demais (limite de ${config.LIMITE_ARQUIVO_MB} MB).`;
  if (!mensagem && err && err.code === 'LIMIT_FILE_COUNT') mensagem = `Arquivos demais de uma vez (limite de ${config.LIMITE_ARQUIVOS}).`;
  if (!mensagem) {
    console.error('[api]', err);
    mensagem = 'Erro inesperado no servidor.';
  }
  if (res.headersSent) return res.end();
  res.status(err && err.usuario ? 400 : 500).json({ ok: false, erro: mensagem });
});

module.exports = router;
