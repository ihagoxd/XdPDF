import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { FERRAMENTAS, buscar } from '../catalogo.js';
import { ir, Ladrilho } from './base.js';

const ACOES = [
  { id: 'inicio', titulo: 'Início', descricao: 'Todas as ferramentas', icone: 'inicio', ir: '/' },
  { id: 'recentes', titulo: 'Arquivos recentes', descricao: 'Baixar de novo o que você já fez', icone: 'relogio', ir: '/recentes' },
  { id: 'config', titulo: 'Configurações', descricao: 'Pasta de saída, OCR e o que está instalado', icone: 'config', ir: '/config' },
];

/** Busca rápida (Ctrl+K): digite e aperte Enter. */
export function Paleta({ aoFechar }) {
  const [texto, setTexto] = useState('');
  const [ativo, setAtivo] = useState(0);
  const campo = useRef(null);
  const lista = useRef(null);

  useEffect(() => { campo.current && campo.current.focus(); }, []);

  const ferramentas = buscar(texto, FERRAMENTAS).map((f) => ({ tipo: 'f', f }));
  const acoes = ACOES.filter((a) => !texto || a.titulo.toLowerCase().includes(texto.toLowerCase())).map((a) => ({ tipo: 'a', a }));
  const itens = [...ferramentas, ...acoes];

  useEffect(() => { setAtivo(0); }, [texto]);
  useEffect(() => {
    const el = lista.current && lista.current.querySelector('.paleta-item.ativo');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  const escolher = (item) => {
    if (!item) return;
    aoFechar();
    if (item.tipo === 'f') ir(`/f/${item.f.id}`);
    else ir(item.a.ir);
  };

  const tecla = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(a + 1, itens.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); escolher(itens[ativo]); }
    else if (e.key === 'Escape') { e.preventDefault(); aoFechar(); }
  };

  return html`<div class="capa paleta-capa" onMouseDown=${(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
    <div class="paleta" role="dialog" aria-label="Procurar ferramenta">
      <div class="paleta-entrada">
        <${Icone} nome="busca" tam=${20} />
        <input ref=${campo} value=${texto} placeholder="O que você quer fazer com o PDF?" onInput=${(e) => setTexto(e.currentTarget.value)} onKeyDown=${tecla} aria-label="Procurar" />
        <kbd>Esc</kbd>
      </div>
      <div class="paleta-lista" ref=${lista}>
        ${itens.length === 0 && html`<div class="paleta-vazio">Nenhuma ferramenta com esse nome.</div>`}
        ${itens.map((item, i) => (item.tipo === 'f'
          ? html`<button key=${item.f.id} class=${cx('paleta-item', i === ativo && 'ativo')} onMouseMove=${() => setAtivo(i)} onClick=${() => escolher(item)}>
              <${Ladrilho} ferramenta=${item.f} tam="p" />
              <span class="texto"><strong>${item.f.titulo}</strong><small>${item.f.descricao}</small></span>
            </button>`
          : html`<button key=${item.a.id} class=${cx('paleta-item', i === ativo && 'ativo')} onMouseMove=${() => setAtivo(i)} onClick=${() => escolher(item)}>
              <span class="ic-acao"><${Icone} nome=${item.a.icone} tam=${16} /></span>
              <span class="texto"><strong>${item.a.titulo}</strong><small>${item.a.descricao}</small></span>
            </button>`))}
      </div>
      <div class="paleta-rodape"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span></div>
    </div>
  </div>`;
}
