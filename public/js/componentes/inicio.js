import { html, useState, useEffect, useRef, cx, preferencias, tamanho, dataRelativa } from '../lib.js';
import { Icone } from '../icones.js';
import { CATEGORIAS, FERRAMENTAS, POR_ID, buscar, indisponivel } from '../catalogo.js';
import { useLoja, api, avisar } from '../loja.js';
import { ir, Ladrilho, IconeArquivo, ehCampoDeTexto, Credito } from './base.js';

function CartaoFerramenta({ f, favorita, aoFavoritar, motivo }) {
  const abrir = () => {
    if (motivo) { avisar(motivo, 'aviso', { titulo: f.titulo }); return; }
    ir(`/f/${f.id}`);
  };
  return html`<div class=${cx('cartao-ferramenta', motivo && 'indisponivel')} style=${`--cor:${f.cor}`}
      role="button" tabIndex="0" onClick=${abrir}
      onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } }}
      title=${motivo || f.descricao}>
    <${Ladrilho} ferramenta=${f} />
    <strong>${f.titulo}</strong>
    <span class="desc">${f.descricao}</span>
    ${motivo && html`<span class="requer">Indisponível nesta máquina</span>`}
    <button class=${cx('btn-icone p favoritar', favorita && 'ligado')}
      onClick=${(e) => { e.stopPropagation(); aoFavoritar(f.id); }}
      title=${favorita ? 'Tirar dos favoritos' : 'Adicionar aos favoritos'}
      aria-label=${favorita ? 'Tirar dos favoritos' : 'Adicionar aos favoritos'}>
      <${Icone} nome="estrela" tam=${16} />
    </button>
  </div>`;
}

function Recentes() {
  const { recentesVersao } = useLoja();
  const [lista, setLista] = useState([]);
  useEffect(() => {
    api.get('/resultados?limite=6').then((d) => setLista(d.resultados)).catch(() => {});
  }, [recentesVersao]);
  if (!lista.length) return null;
  return html`<div class="secao">
    <div class="secao-titulo">Recentes</div>
    <div class="recentes-faixa">
      ${lista.map((r) => html`<a class="linha-recente" key=${r.id} href=${`/api/resultados/${r.id}`} download title="Baixar de novo">
        <${IconeArquivo} nome=${r.nome} p />
        <div class="texto"><strong>${r.nome}</strong><small>${tamanho(r.tamanho)} · ${dataRelativa(r.criadoEm)}${r.ferramenta && POR_ID[r.ferramenta] ? ` · ${POR_ID[r.ferramenta].titulo}` : ''}</small></div>
        <${Icone} nome="baixar" tam=${16} />
      </a>`)}
    </div>
  </div>`;
}

export function Inicio({ categoria, aoCategoria }) {
  const { sistema } = useLoja();
  const cap = sistema && sistema.capacidades;
  const [busca, setBusca] = useState('');
  const [favoritas, setFavoritas] = useState(() => preferencias.ler('favoritas', ['juntar', 'comprimir', 'dividir', 'assinar']));
  const campo = useRef(null);

  // Começar a digitar em qualquer lugar já procura
  useEffect(() => {
    const f = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ehCampoDeTexto(document.activeElement)) return;
      if (e.key.length === 1 && /\S/.test(e.key) && campo.current) campo.current.focus();
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const alternarFavorita = (id) => {
    const nova = favoritas.includes(id) ? favoritas.filter((x) => x !== id) : [...favoritas, id];
    setFavoritas(nova);
    preferencias.gravar('favoritas', nova);
  };

  const achadas = buscar(busca, categoria ? FERRAMENTAS.filter((f) => f.categoria === categoria) : FERRAMENTAS);
  const cartao = (f) => html`<${CartaoFerramenta} key=${f.id} f=${f} favorita=${favoritas.includes(f.id)}
    aoFavoritar=${alternarFavorita} motivo=${indisponivel(f, cap)} />`;

  const mostrandoTudo = !busca && !categoria;
  const continuando = (() => {
    try { return JSON.parse(sessionStorage.getItem('xdpdf-continuar') || '[]').length; } catch (_) { return 0; }
  })();
  const [, recarregar] = useState(0);
  const favs = favoritas.map((id) => POR_ID[id]).filter(Boolean);

  return html`<div class="pagina">
    <div class="inicio-topo">
      <div>
        <h1>Ferramentas de PDF</h1>
        <p>Juntar, dividir, comprimir, converter e assinar — aqui no computador, sem mandar nada para a internet.</p>
      </div>
      <label class="campo-busca">
        <${Icone} nome="busca" tam=${17} />
        <input ref=${campo} type="search" placeholder="Procurar: juntar, comprimir, assinar..." value=${busca}
          onInput=${(e) => setBusca(e.currentTarget.value)}
          onKeyDown=${(e) => {
            if (e.key === 'Escape') { setBusca(''); e.currentTarget.blur(); }
            if (e.key === 'Enter' && achadas[0]) ir(`/f/${achadas[0].id}`);
          }}
          aria-label="Procurar ferramenta" />
      </label>
    </div>

    ${continuando > 0 && html`<div class="faixa-continuar" role="status">
      <${Icone} nome="seta" tam=${18} />
      <span><strong>Escolha a próxima ferramenta.</strong> ${continuando === 1 ? 'O arquivo já vai estar lá' : `Os ${continuando} arquivos já vão estar lá`}.</span>
      <button class="btn btn-p" onClick=${() => { sessionStorage.removeItem('xdpdf-continuar'); recarregar((n) => n + 1); }}>Cancelar</button>
    </div>`}

    <div class="filtros" role="tablist">
      <button class=${cx('filtro', !categoria && 'ativo')} onClick=${() => aoCategoria(null)}>Todas</button>
      ${CATEGORIAS.map((c) => html`<button key=${c.id} class=${cx('filtro', categoria === c.id && 'ativo')} style=${`--cor:${c.cor}`} onClick=${() => aoCategoria(c.id)}>
        <${Icone} nome=${c.icone} tam=${15} />${c.titulo}
      </button>`)}
    </div>

    ${mostrandoTudo && favs.length > 0 && html`<div class="secao">
      <div class="secao-titulo"><${Icone} nome="estrela" tam=${14} /> Favoritas</div>
      <div class="grade-ferramentas">${favs.map(cartao)}</div>
    </div>`}

    ${busca
      ? (achadas.length
        ? html`<div class="secao"><div class="grade-ferramentas">${achadas.map(cartao)}</div></div>`
        : html`<div class="vazio-estado"><${Icone} nome="busca" tam=${36} /><strong>Nada encontrado</strong>Tente outra palavra, como "juntar" ou "senha".</div>`)
      : CATEGORIAS.filter((c) => !categoria || c.id === categoria).map((c) => html`<div class="secao" key=${c.id}>
          <div class="secao-titulo" style=${`--cor:${c.cor}`}><span class="secao-icone"><${Icone} nome=${c.icone} tam=${15} /></span>${c.titulo}</div>
          <div class="grade-ferramentas">${FERRAMENTAS.filter((f) => f.categoria === c.id).map(cartao)}</div>
        </div>`)}

    ${mostrandoTudo && html`<${Recentes} />`}

    <footer class="rodape-pagina"><${Credito} classe="so-movel-credito" /></footer>
  </div>`;
}
