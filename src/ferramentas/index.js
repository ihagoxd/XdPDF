'use strict';

/**
 * Catálogo do lado do servidor: o que cada ferramenta aceita e quem executa.
 *
 * entrada:
 *   'pronto'   arquivos já com a cópia de trabalho em PDF (padrão)
 *   'bruto'    aceita também arquivos com erro (reparar) ou com senha (desbloquear)
 *   'nenhuma'  não usa arquivos (site para PDF)
 */

const armazem = require('../nucleo/armazem');
const tarefas = require('../nucleo/tarefas');
const { ErroUsuario } = require('../nucleo/util');

const organizar = require('./organizar');

const CATALOGO = {
  juntar: { executar: organizar.juntar, min: 2 },
  dividir: { executar: organizar.dividir },
  remover: { executar: organizar.remover },
  extrair: { executar: organizar.extrair },
  organizar: { executar: organizar.organizar },
  girar: { executar: organizar.girar },
};

function registrar(id, definicao) {
  CATALOGO[id] = definicao;
}

function existe(id) {
  return Boolean(CATALOGO[id]);
}

/**
 * Valida e coloca a ferramenta para rodar.
 * @returns tarefa pública
 */
function executar(id, { arquivos: ids = [], opcoes = {} } = {}) {
  const def = CATALOGO[id];
  if (!def) throw new ErroUsuario('Ferramenta desconhecida.');

  let arquivos = [];
  if (def.entrada !== 'nenhuma') {
    if (!Array.isArray(ids) || !ids.length) throw new ErroUsuario('Adicione pelo menos um arquivo.');
    arquivos = ids.map((aid) => {
      if (def.entrada === 'bruto') {
        const a = armazem.obter(aid);
        if (!a) throw new ErroUsuario('Um dos arquivos não está mais disponível. Adicione de novo.');
        if (a.estado === 'preparando') throw new ErroUsuario(`"${a.nome}" ainda está sendo preparado.`);
        return a;
      }
      return armazem.exigirPronto(aid);
    });
    if (def.tipos) {
      const fora = arquivos.find((a) => !def.tipos.includes(a.tipo));
      if (fora) throw new ErroUsuario(`"${fora.nome}" não serve para esta ferramenta.`);
    }
    if (def.min && arquivos.length < def.min) {
      throw new ErroUsuario(def.min === 2 ? 'Adicione pelo menos dois arquivos.' : `Adicione pelo menos ${def.min} arquivos.`);
    }
    if (def.max && arquivos.length > def.max) {
      throw new ErroUsuario(def.max === 1 ? 'Esta ferramenta trabalha com um arquivo por vez.' : `No máximo ${def.max} arquivos.`);
    }
  }

  return tarefas.iniciar(id, (ctx) => def.executar({ arquivos, opcoes: opcoes || {} }, ctx));
}

module.exports = { executar, existe, registrar, CATALOGO };
