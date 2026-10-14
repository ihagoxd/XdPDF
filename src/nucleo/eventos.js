'use strict';

/**
 * Canal de eventos em tempo real (Server-Sent Events).
 * O navegador fica ouvindo e recebe progresso, arquivos prontos e o fim das
 * tarefas sem precisar perguntar de segundo em segundo.
 *
 * Também serve para saber se a janela do app ainda está aberta: no modo app,
 * quando o último cliente desconecta, o servidor encerra sozinho.
 */

const { EventEmitter } = require('events');

const clientes = new Set();
const emissor = new EventEmitter();
emissor.setMaxListeners(100);

let ultimoId = 0;

function escrever(res, tipo, dados) {
  ultimoId += 1;
  res.write(`id: ${ultimoId}\nevent: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
}

/** Rota GET /api/eventos */
function conectar(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  clientes.add(res);
  emissor.emit('clientes', clientes.size);
  escrever(res, 'ola', { clientes: clientes.size });

  const batida = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(batida);
    clientes.delete(res);
    emissor.emit('clientes', clientes.size);
  });
}

/** Manda um evento para todas as janelas abertas. */
function publicar(tipo, dados) {
  for (const res of clientes) {
    try { escrever(res, tipo, dados); } catch (_) { /* conexão caindo */ }
  }
}

module.exports = {
  conectar,
  publicar,
  quantos: () => clientes.size,
  aoMudarClientes: (fn) => emissor.on('clientes', fn),
};
