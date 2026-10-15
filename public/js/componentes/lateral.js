import { html, useState, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { CATEGORIAS } from '../catalogo.js';
import { ir, Credito } from './base.js';

function lerTema() {
  try { return localStorage.getItem('meupdf-tema') || 'sistema'; } catch (_) { return 'sistema'; }
}

function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'claro' || tema === 'escuro') raiz.setAttribute('data-tema', tema);
  else raiz.removeAttribute('data-tema');
  try { localStorage.setItem('meupdf-tema', tema); } catch (_) { /* sem armazenamento */ }
}

export function Lateral({ rota, aoBuscar, categoria, aoCategoria }) {
  const [tema, setTema] = useState(lerTema());
  const trocarTema = (t) => { setTema(t); aplicarTema(t); };
  const naInicio = rota.tela === 'inicio';

  return html`<aside class="lateral">
    <a class="marca" href="#/" aria-label="MeuPDF — início">
      <img class="marca-logo" src="/icones/meupdf.svg" alt="" />
      <span>
        <span class="marca-nome"><b>Meu</b>PDF</span>
        <span class="marca-sub">Ferramentas de PDF</span>
      </span>
    </a>

    <button class="busca-gatilho" onClick=${aoBuscar} title="Procurar ferramenta (Ctrl+K)">
      <${Icone} nome="busca" tam=${16} />
      <span>Procurar ferramenta</span>
      <kbd>Ctrl K</kbd>
    </button>

    <nav class="nav" aria-label="Navegação">
      <button class=${cx('nav-item', naInicio && !categoria && 'ativo')} onClick=${() => { aoCategoria(null); ir('/'); }}>
        <${Icone} nome="inicio" /><span>Todas as ferramentas</span>
      </button>
      <div class="nav-secao">Categorias</div>
      ${CATEGORIAS.map((c) => html`<button key=${c.id}
          class=${cx('nav-item', naInicio && categoria === c.id && 'ativo')}
          onClick=${() => { aoCategoria(c.id); ir('/'); }}>
          <span class="nav-icone" style=${`--cor:${c.cor}`}><${Icone} nome=${c.icone} tam=${16} /></span><span>${c.titulo}</span>
        </button>`)}
      <div class="nav-secao">Seu trabalho</div>
      <button class=${cx('nav-item', rota.tela === 'recentes' && 'ativo')} onClick=${() => ir('/recentes')}>
        <${Icone} nome="relogio" /><span>Arquivos recentes</span>
      </button>
      <button class=${cx('nav-item', rota.tela === 'config' && 'ativo')} onClick=${() => ir('/config')}>
        <${Icone} nome="config" /><span>Configurações</span>
      </button>
    </nav>

    <div class="lateral-rodape">
      <div class="selo-local" title="Os arquivos são processados aqui mesmo, sem internet.">
        <${Icone} nome="escudo" tam=${18} />
        <div>100% no seu computador<small>Nenhum arquivo sai daqui</small></div>
      </div>
      <div class="tema-alternador" role="radiogroup" aria-label="Tema">
        <button class=${cx(tema === 'claro' && 'ativo')} onClick=${() => trocarTema('claro')} title="Tema claro" aria-label="Tema claro"><${Icone} nome="sol" tam=${16} /></button>
        <button class=${cx(tema === 'sistema' && 'ativo')} onClick=${() => trocarTema('sistema')} title="Igual ao Windows" aria-label="Tema do sistema"><${Icone} nome="monitor" tam=${16} /></button>
        <button class=${cx(tema === 'escuro' && 'ativo')} onClick=${() => trocarTema('escuro')} title="Tema escuro" aria-label="Tema escuro"><${Icone} nome="lua" tam=${16} /></button>
      </div>
      <${Credito} />
    </div>
  </aside>`;
}
