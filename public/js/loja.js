import { useEffect, useReducer } from './lib.js';

/* ============================================================
   Estado global + conversa com o servidor
   ============================================================ */

export const estado = {
  sistema: null,          // versão, capacidades e configuração
  arquivos: {},           // id -> arquivo (atualizado em tempo real)
  tarefas: {},            // id -> tarefa
  toasts: [],
  conectado: false,
  recentesVersao: 0,      // muda quando aparece resultado novo
};

const ouvintes = new Set();
let agendado = false;

/** Muda o estado e redesenha quem estiver ouvindo (uma vez por quadro). */
export function mudar(fn) {
  if (fn) fn(estado);
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    ouvintes.forEach((o) => o());
  });
}

export function useLoja() {
  const [, forcar] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    ouvintes.add(forcar);
    return () => ouvintes.delete(forcar);
  }, []);
  return estado;
}

/* ---------------- avisos (toasts) ---------------- */

let idToast = 0;

export function avisar(texto, tipo = 'info', { titulo, duracao } = {}) {
  idToast += 1;
  const id = idToast;
  mudar((e) => { e.toasts = [...e.toasts.slice(-3), { id, texto, tipo, titulo }]; });
  const ms = duracao != null ? duracao : tipo === 'erro' ? 8000 : 4200;
  if (ms > 0) setTimeout(() => fecharAviso(id), ms);
  return id;
}

export function fecharAviso(id) {
  mudar((e) => { e.toasts = e.toasts.filter((t) => t.id !== id); });
}

/* ---------------- HTTP ---------------- */

async function lerResposta(r) {
  let dados = {};
  try { dados = await r.json(); } catch (_) { /* resposta sem corpo */ }
  if (!r.ok || dados.ok === false) {
    const err = new Error(dados.erro || (r.status === 404 ? 'Não encontrado.' : 'O servidor não respondeu como esperado.'));
    err.status = r.status;
    throw err;
  }
  return dados;
}

export const api = {
  async get(caminho) {
    return lerResposta(await fetch(`/api${caminho}`));
  },
  async post(caminho, corpo) {
    return lerResposta(await fetch(`/api${caminho}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}),
    }));
  },
  async put(caminho, corpo) {
    return lerResposta(await fetch(`/api${caminho}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}),
    }));
  },
  async del(caminho) {
    return lerResposta(await fetch(`/api${caminho}`, { method: 'DELETE' }));
  },
};

/**
 * Envia arquivos com barra de progresso.
 * @param {File[]} lista
 * @param {(pct:number)=>void} aoProgredir
 * @returns {Promise<object[]>} arquivos registrados
 */
export function enviarArquivos(lista, aoProgredir) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    lista.forEach((f) => fd.append('arquivos', f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/arquivos');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && aoProgredir) aoProgredir(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const d = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300 && d.ok !== false) {
        mudar((e) => { for (const a of d.arquivos) e.arquivos[a.id] = a; });
        resolve(d.arquivos);
      } else {
        reject(new Error(d.erro || 'Não foi possível enviar os arquivos.'));
      }
    };
    xhr.onerror = () => reject(new Error('A conexão com o XdPDF caiu durante o envio.'));
    xhr.send(fd);
  });
}

/* ---------------- tempo real ---------------- */

let fonte = null;

export function conectarEventos() {
  if (fonte) return;
  fonte = new EventSource('/api/eventos');
  fonte.addEventListener('ola', () => mudar((e) => { e.conectado = true; }));
  fonte.addEventListener('arquivo', (ev) => {
    const a = JSON.parse(ev.data);
    mudar((e) => { e.arquivos[a.id] = a; });
  });
  fonte.addEventListener('tarefa', (ev) => {
    const t = JSON.parse(ev.data);
    mudar((e) => {
      e.tarefas[t.id] = t;
      if (t.estado === 'concluida') e.recentesVersao += 1;
    });
  });
  fonte.onerror = () => mudar((e) => { e.conectado = false; });
}

export async function carregarSistema() {
  const d = await api.get('/sistema');
  mudar((e) => { e.sistema = d; });
  return d;
}

/** Espera a tarefa terminar (pelos eventos, com consulta de reserva). */
export function aguardarTarefa(id) {
  return new Promise((resolve) => {
    let terminou = false;
    const verificar = () => {
      const t = estado.tarefas[id];
      if (t && ['concluida', 'erro', 'cancelada'].includes(t.estado)) {
        terminou = true;
        ouvintes.delete(verificar);
        clearInterval(reserva);
        resolve(t);
      }
    };
    ouvintes.add(verificar);
    // se um evento se perder (reconexão), pergunta direto ao servidor
    const reserva = setInterval(async () => {
      if (terminou) return;
      try {
        const d = await api.get(`/tarefas/${id}`);
        mudar((e) => { e.tarefas[id] = d.tarefa; });
        verificar();
      } catch (_) { /* tenta de novo */ }
    }, 4000);
    verificar();
  });
}
