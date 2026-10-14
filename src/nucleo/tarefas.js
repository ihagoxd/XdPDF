'use strict';

/**
 * Execução das ferramentas em segundo plano.
 *
 * A requisição volta na hora com o id da tarefa; o progresso e o fim chegam
 * pelo canal de eventos. Assim um OCR de 200 páginas não esbarra em limite de
 * tempo de requisição, e dá para cancelar no meio.
 */

const eventos = require('./eventos');
const armazem = require('./armazem');
const { novoId, Cancelado } = require('./util');

const SIMULTANEAS = 2;
const tarefas = new Map();
const fila = [];
let rodando = 0;

function publica(t) {
  return {
    id: t.id,
    ferramenta: t.ferramenta,
    estado: t.estado,
    progresso: t.progresso,
    texto: t.texto,
    erro: t.erro,
    avisos: t.avisos,
    dados: t.dados,
    resultados: t.resultados.map(armazem.publicoResultado),
    criadoEm: t.criadoEm,
    terminadoEm: t.terminadoEm,
  };
}

function avisar(t) {
  eventos.publicar('tarefa', publica(t));
}

/**
 * @param {string} ferramenta
 * @param {(ctx:object)=>Promise<void>} executar recebe o contexto da tarefa
 */
function iniciar(ferramenta, executar) {
  const t = {
    id: novoId(),
    ferramenta,
    estado: 'fila',
    progresso: 0,
    texto: 'Aguardando...',
    erro: null,
    avisos: [],
    dados: null,
    resultados: [],
    criadoEm: Date.now(),
    terminadoEm: null,
    cancelar: false,
    executar,
  };
  tarefas.set(t.id, t);
  fila.push(t);
  avisar(t);
  proxima();
  limparAntigas();
  return publica(t);
}

function proxima() {
  while (rodando < SIMULTANEAS && fila.length) {
    const t = fila.shift();
    if (t.cancelar) continue;
    rodando += 1;
    rodar(t).finally(() => {
      rodando -= 1;
      proxima();
    });
  }
}

async function rodar(t) {
  t.estado = 'rodando';
  t.texto = 'Processando...';
  avisar(t);

  let ultimoAviso = 0;
  const ctx = {
    id: t.id,
    /** Atualiza a barra (0 a 100) e a frase que aparece na tela. */
    progresso(pct, texto) {
      if (pct != null) t.progresso = Math.max(0, Math.min(100, Math.round(pct)));
      if (texto) t.texto = texto;
      const agora = Date.now();
      if (agora - ultimoAviso > 120 || pct >= 100) {
        ultimoAviso = agora;
        avisar(t);
      }
    },
    /** Interrompe se a pessoa cancelou. Chamar entre páginas/arquivos. */
    checar() {
      if (t.cancelar) throw new Cancelado();
    },
    aviso(texto) {
      if (!t.avisos.includes(texto)) t.avisos.push(texto);
    },
    /** Dados extras para a tela (ex.: as diferenças do Comparar). */
    dados(valor) {
      t.dados = valor;
    },
    /** Grava um arquivo de saída desta tarefa. */
    async gravar(nome, bytes, meta = {}) {
      const r = await armazem.gravarResultado(nome, bytes, { ...meta, ferramenta: t.ferramenta, tarefa: t.id });
      t.resultados.push(r);
      return r;
    },
  };

  try {
    await t.executar(ctx);
    if (t.cancelar) throw new Cancelado();
    if (!t.resultados.length) throw new Error('A operação terminou sem gerar nenhum arquivo.');
    t.estado = 'concluida';
    t.progresso = 100;
    t.texto = 'Pronto';
  } catch (err) {
    if (err && err.cancelado) {
      t.estado = 'cancelada';
      t.texto = 'Cancelada';
      // o que já tinha sido gerado não serve mais
      await armazem.removerResultados(t.resultados.map((r) => r.id));
      t.resultados = [];
    } else {
      t.estado = 'erro';
      t.erro = err && err.usuario ? err.message : mensagemDeErro(err);
      if (!(err && err.usuario)) console.error(`[tarefa ${t.ferramenta}]`, err);
    }
  } finally {
    t.terminadoEm = Date.now();
    t.executar = null;
    avisar(t);
  }
}

function mensagemDeErro(err) {
  const msg = String((err && err.message) || err || '');
  if (/ENOSPC/.test(msg)) return 'O disco está cheio.';
  if (/ENOMEM|allocation failed|heap out of memory/i.test(msg)) return 'Faltou memória para um arquivo tão grande. Tente dividir o PDF antes.';
  if (/EBUSY|EPERM/.test(msg)) return 'Um arquivo está em uso por outro programa. Feche e tente de novo.';
  return `Algo deu errado: ${msg.split('\n')[0].slice(0, 200)}`;
}

function obter(id) {
  const t = tarefas.get(id);
  return t ? publica(t) : null;
}

function cancelar(id) {
  const t = tarefas.get(id);
  if (!t) return null;
  if (t.estado === 'fila' || t.estado === 'rodando') {
    t.cancelar = true;
    t.texto = 'Cancelando...';
    if (t.estado === 'fila') {
      t.estado = 'cancelada';
      t.terminadoEm = Date.now();
    }
    avisar(t);
  }
  return publica(t);
}

function limparAntigas() {
  const limite = Date.now() - 6 * 3600e3;
  for (const [id, t] of tarefas) {
    if (t.terminadoEm && t.terminadoEm < limite) tarefas.delete(id);
  }
}

module.exports = { iniciar, obter, cancelar };
