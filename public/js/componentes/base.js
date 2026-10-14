import { html, useEffect, useRef, useState, cx, corDaExtensao, extensao } from '../lib.js';
import { Icone } from '../icones.js';
import { useLoja, fecharAviso } from '../loja.js';

/* ---------------- rotas (#/...) ---------------- */

export function lerRota() {
  const partes = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  return { tela: partes[0] || 'inicio', param: partes[1] ? decodeURIComponent(partes[1]) : null };
}

export function ir(caminho) {
  const alvo = `#/${caminho.replace(/^\/+/, '')}`;
  if (location.hash !== alvo) location.hash = alvo;
}

export function useRota() {
  const [rota, setRota] = useState(lerRota());
  useEffect(() => {
    const f = () => setRota(lerRota());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}

/* ---------------- toasts ---------------- */

export function Toasts() {
  const { toasts } = useLoja();
  const icone = { ok: 'okCirculo', erro: 'erro', aviso: 'alerta', info: 'info' };
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<div class=${`toast ${t.tipo}`} key=${t.id}>
      <${Icone} nome=${icone[t.tipo] || 'info'} tam=${18} />
      <div class="texto">${t.titulo && html`<strong>${t.titulo}</strong>`}${t.texto}</div>
      <button class="btn-icone p" onClick=${() => fecharAviso(t.id)} aria-label="Fechar aviso"><${Icone} nome="x" tam=${15} /></button>
    </div>`)}
  </div>`;
}

/* ---------------- diálogo ---------------- */

export function Dialogo({ titulo, aoFechar, children, rodape, classe = '', icone }) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && aoFechar) { e.stopPropagation(); aoFechar(); } };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, [aoFechar]);
  return html`<div class="capa" onMouseDown=${(e) => { if (e.target === e.currentTarget && aoFechar) aoFechar(); }}>
    <div class=${cx('dialogo', classe)} role="dialog" aria-modal="true" aria-label=${titulo}>
      <div class="dialogo-cab">
        ${icone}
        <h3>${titulo}</h3>
        ${aoFechar && html`<button class="btn-icone" onClick=${aoFechar} aria-label="Fechar"><${Icone} nome="x" /></button>`}
      </div>
      ${children}
      ${rodape && html`<div class="dialogo-rodape">${rodape}</div>`}
    </div>
  </div>`;
}

/* ---------------- pequenos componentes ---------------- */

export function Ladrilho({ ferramenta, tam = '' }) {
  return html`<span class=${cx('ladrilho', tam)} style=${`--cor:${ferramenta.cor}`}>
    <${Icone} nome=${ferramenta.icone} tam=${tam === 'g' ? 26 : tam === 'p' ? 16 : 22} />
  </span>`;
}

export function IconeArquivo({ nome, p }) {
  const ext = extensao(nome) || '?';
  return html`<span class=${cx('icone-arquivo', p && 'p')} style=${`--cor-ext:${corDaExtensao(nome)}`}>${ext.slice(0, 4).toUpperCase()}</span>`;
}

export function Alerta({ nivel = 'info', children }) {
  const icone = { info: 'info', aviso: 'alerta', erro: 'erro', ok: 'okCirculo' };
  return html`<div class=${`alerta ${nivel}`}><${Icone} nome=${icone[nivel]} tam=${17} /><div>${children}</div></div>`;
}

export function Anel({ tam = '' }) {
  return html`<span class=${cx('anel', tam)} aria-hidden="true"></span>`;
}

/** Fecha ao clicar fora. */
export function useForaClique(ref, aoFechar, ativo = true) {
  useEffect(() => {
    if (!ativo) return undefined;
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) aoFechar(); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [ativo, aoFechar]);
}

/** Atalho de teclado global. */
export function useAtalho(teste, acao, deps = []) {
  const ref = useRef(acao);
  ref.current = acao;
  useEffect(() => {
    const f = (e) => {
      if (teste(e)) { e.preventDefault(); ref.current(e); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, deps);
}

export function ehCampoDeTexto(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
