import { html, useRef, cx, plural, tamanho, corDaExtensao, extensao } from '../lib.js';
import { Icone } from '../icones.js';
import { Miniatura } from '../pdfvisual.js';
import { useOrdenavel } from '../arrastar.js';
import { Anel } from './base.js';
import { abrirVisualizador } from './visualizador.js';

const NATIVAS = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp']);

/** Miniatura do arquivo: a 1ª página do PDF ou a própria imagem. */
export function MiniaturaArquivo({ a, largura = 180 }) {
  const ext = extensao(a.nome);
  if (a.tipo === 'imagem' && NATIVAS.has(ext)) {
    return html`<img class="miniatura" src=${`/api/arquivos/${a.id}/original`} alt="" loading="lazy" draggable="false" />`;
  }
  if (a.estado === 'pronto') {
    return html`<${Miniatura} url=${`/api/arquivos/${a.id}/pdf`} pagina=${1} largura=${largura} />`;
  }
  return html`<div class="miniatura-vazia">
    <span class="extensao-selo" style=${`--cor-ext:${corDaExtensao(a.nome)}`}>${(ext || '?').toUpperCase()}</span>
    ${a.estado === 'preparando' && html`<${Anel} tam="m" /><span>${a.tipo === 'office' ? 'Convertendo...' : 'Lendo...'}</span>`}
    ${a.estado === 'senha' && html`<${Icone} nome="cadeado" tam=${26} />`}
    ${a.estado === 'erro' && html`<${Icone} nome="alerta" tam=${26} />`}
  </div>`;
}

export function SeloEstado({ a, aoSenha }) {
  if (a.estado === 'preparando') return html`<span class="estado-selo preparando">${a.tipo === 'office' ? 'Convertendo' : 'Preparando'}</span>`;
  if (a.estado === 'senha') {
    return html`<button class="estado-selo senha" style="border:0;cursor:pointer" onClick=${(e) => { e.stopPropagation(); aoSenha(a); }}>
      <${Icone} nome="chave" tam=${12} /> Digitar senha
    </button>`;
  }
  if (a.estado === 'erro') return html`<span class="estado-selo erro" title=${a.erro}>${a.erro}</span>`;
  if (a.protegido) return html`<span class="estado-selo protegido" title="Tinha restrições de impressão ou cópia; já foram tiradas para trabalhar.">Liberado</span>`;
  return null;
}

export function CartaoArquivo({ a, ordem, aoRemover, aoSenha, arrastavel }) {
  const ver = () => {
    if (a.estado !== 'pronto') return;
    abrirVisualizador({ titulo: a.nome, url: `/api/arquivos/${a.id}/pdf` });
  };
  return html`<div class=${cx('cartao-arquivo', arrastavel && 'arrastavel', a.estado === 'erro' && 'erro')} data-id=${a.id}
      title=${arrastavel ? 'Arraste para mudar a ordem' : a.nome}>
    ${ordem != null && html`<span class="ordem">${ordem}</span>`}
    <div class="miniatura-caixa"><${MiniaturaArquivo} a=${a} /></div>
    <div class="acoes-cartao">
      ${a.estado === 'pronto' && html`<button class="btn-icone p" onClick=${ver} title="Ver o documento" aria-label="Ver o documento"><${Icone} nome="olho" tam=${15} /></button>`}
      <button class="btn-icone p perigo" onClick=${() => aoRemover(a.id)} title="Tirar da lista" aria-label="Tirar da lista"><${Icone} nome="x" tam=${15} /></button>
    </div>
    <div class="nome">${a.nome}</div>
    <div class="meta">
      ${a.paginas ? html`<span>${plural(a.paginas, 'página', 'páginas')}</span><span>·</span>` : ''}
      <span>${tamanho(a.tamanho)}</span>
      <${SeloEstado} a=${a} aoSenha=${aoSenha} />
    </div>
  </div>`;
}

const comparar = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function AreaArquivos({ ferramenta: f, arquivos, ids, setIds, aoRemover, aoAdicionar, aoSenha, enviando }) {
  const grade = useRef(null);
  const ordenavel = Boolean(f.ordenavel) && arquivos.length > 1;
  useOrdenavel({ container: grade, ordem: ids, aoMudar: setIds, ativo: ordenavel });

  const totalPaginas = arquivos.reduce((s, a) => s + (a.paginas || 0), 0);
  const totalBytes = arquivos.reduce((s, a) => s + (a.tamanho || 0), 0);

  const ordenarNome = (inverso) => {
    const porId = new Map(arquivos.map((a) => [a.id, a]));
    const nova = ids.slice().sort((x, y) => {
      const r = comparar.compare((porId.get(x) || {}).nome || '', (porId.get(y) || {}).nome || '');
      return inverso ? -r : r;
    });
    setIds(nova);
  };

  return html`<div>
    <div class="bancada-barra">
      <span class="resumo"><b>${plural(arquivos.length, 'arquivo', 'arquivos')}</b>${totalPaginas ? ` · ${plural(totalPaginas, 'página', 'páginas')}` : ''} · ${tamanho(totalBytes)}</span>
      ${ordenavel && html`
        <button class="btn btn-p btn-fantasma" onClick=${() => ordenarNome(false)} title="Ordenar por nome"><${Icone} nome="ordenarAZ" tam=${16} /> A–Z</button>
        <button class="btn btn-p btn-fantasma" onClick=${() => setIds(ids.slice().reverse())} title="Inverter a ordem"><${Icone} nome="inverter" tam=${16} /> Inverter</button>`}
    </div>
    ${ordenavel && html`<p style="color:var(--texto-3);font-size:12.5px;margin:-4px 0 12px">Arraste os cartões para mudar a ordem${'ontouchstart' in window ? ' (segure e arraste)' : ''}.</p>`}
    <div class="grade-arquivos" ref=${grade}>
      ${arquivos.map((a, i) => html`<${CartaoArquivo} key=${a.id} a=${a} ordem=${ordenavel ? i + 1 : null}
        arrastavel=${ordenavel} aoRemover=${aoRemover} aoSenha=${aoSenha} />`)}
      ${f.max !== 1 && html`<button class="adicionar-cartao" onClick=${aoAdicionar} disabled=${Boolean(enviando)}>
        <${Icone} nome="mais" tam=${26} />Adicionar mais
      </button>`}
    </div>
  </div>`;
}
