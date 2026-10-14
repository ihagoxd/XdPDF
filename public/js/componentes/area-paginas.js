import { html, useState, useEffect, useRef, cx, plural, preferencias, semExtensao } from '../lib.js';
import { Icone } from '../icones.js';
import { Miniatura, tamanhos as lerTamanhos } from '../pdfvisual.js';
import { useOrdenavel } from '../arrastar.js';
import { Anel } from './base.js';
import { SeloEstado } from './area-arquivos.js';
import { abrirVisualizador } from './visualizador.js';

/* ---------------- intervalos "1-3, 7" ---------------- */

export function paraConjunto(texto, total) {
  const set = new Set();
  for (const parte of String(texto || '').split(/[,;]/)) {
    const t = parte.trim();
    if (!t) continue;
    const m = t.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m && (m[1] || m[2])) {
      let a = m[1] ? Number(m[1]) : 1;
      let b = m[2] ? Number(m[2]) : total;
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i += 1) if (i >= 1 && i <= total) set.add(i);
    } else if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n >= 1 && n <= total) set.add(n);
    }
  }
  return set;
}

export function paraTexto(paginas) {
  const nums = Array.from(new Set(paginas)).sort((a, b) => a - b);
  const trechos = [];
  for (let i = 0; i < nums.length; i += 1) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    trechos.push(i === j ? String(nums[i]) : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return trechos.join(', ');
}

/* ---------------- tamanhos das páginas (para a proporção do cartão) ---------------- */

const cacheTamanhos = new Map();

function useTamanhos(arquivo) {
  const url = arquivo && arquivo.estado === 'pronto' ? `/api/arquivos/${arquivo.id}/pdf` : null;
  const [lista, setLista] = useState(() => (url && cacheTamanhos.get(url)) || null);
  useEffect(() => {
    if (!url) return undefined;
    let vivo = true;
    if (cacheTamanhos.has(url)) { setLista(cacheTamanhos.get(url)); return undefined; }
    lerTamanhos(url).then((t) => { cacheTamanhos.set(url, t); if (vivo) setLista(t); }).catch(() => {});
    return () => { vivo = false; };
  }, [url]);
  return lista;
}

/** Tamanhos de vários arquivos de uma vez (a lista de arquivos pode mudar). */
function useTamanhosVarios(arquivos) {
  const [mapa, setMapa] = useState({});
  const chave = arquivos.map((a) => `${a.id}:${a.estado}`).join('|');
  useEffect(() => {
    let vivo = true;
    for (const a of arquivos) {
      if (a.estado !== 'pronto') continue;
      const url = `/api/arquivos/${a.id}/pdf`;
      if (cacheTamanhos.has(url)) {
        if (!mapa[a.id]) setMapa((m) => ({ ...m, [a.id]: cacheTamanhos.get(url) }));
        continue;
      }
      lerTamanhos(url).then((t) => {
        cacheTamanhos.set(url, t);
        if (vivo) setMapa((m) => ({ ...m, [a.id]: t }));
      }).catch(() => {});
    }
    return () => { vivo = false; };
  }, [chave]);
  return mapa;
}

/** No celular as miniaturas ficam menores. */
function useEstreito() {
  const consulta = '(max-width: 820px)';
  const [estreito, setEstreito] = useState(() => matchMedia(consulta).matches);
  useEffect(() => {
    const m = matchMedia(consulta);
    const f = () => setEstreito(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return estreito;
}

/* ---------------- resumo e validação (usado pelo painel) ---------------- */

function totalDe(arquivos) {
  return arquivos.filter((a) => a.estado === 'pronto').reduce((s, a) => s + (a.paginas || 0), 0);
}

export function resumoPaginas(f, arquivos, extra) {
  const prontos = arquivos.filter((a) => a.estado === 'pronto');
  const modo = f.modoPaginas;
  if (modo === 'remover' || modo === 'selecionar') {
    const sel = extra.selecao || {};
    const n = prontos.reduce((s, a) => s + (sel[a.id] || []).length, 0);
    if (!n) return { problema: modo === 'remover' ? 'Clique nas páginas que devem sair.' : 'Clique nas páginas que quer extrair.', texto: null };
    if (modo === 'remover') {
      const cheio = prontos.find((a) => (sel[a.id] || []).length >= a.paginas);
      if (cheio) return { problema: `Não dá para tirar todas as páginas de "${cheio.nome}".`, texto: null };
      return { problema: null, texto: `${plural(n, 'página vai sair', 'páginas vão sair')} de ${plural(totalDe(prontos), 'página', 'páginas')}.` };
    }
    return { problema: null, texto: `${plural(n, 'página escolhida', 'páginas escolhidas')}.` };
  }
  if (modo === 'girar') {
    const rot = extra.rotacoes || {};
    const n = prontos.reduce((s, a) => s + Object.values(rot[a.id] || {}).filter((g) => g % 360).length, 0);
    if (!n) return { problema: 'Clique nas páginas para girar, ou use "Girar todas".', texto: null };
    return { problema: null, texto: `${plural(n, 'página girada', 'páginas giradas')}.` };
  }
  if (modo === 'organizar') {
    const lista = extra.lista || [];
    if (!lista.length) return { problema: 'Não sobrou nenhuma página.', texto: null };
    return { problema: null, texto: `O PDF final vai ter ${plural(lista.length, 'página', 'páginas')}.` };
  }
  return { problema: null, texto: null };
}

export function opcoesDasPaginas(f, arquivos, extra) {
  const modo = f.modoPaginas;
  if (modo === 'remover' || modo === 'selecionar') return { selecao: extra.selecao || {} };
  if (modo === 'girar') return { rotacoes: extra.rotacoes || {} };
  if (modo === 'organizar') {
    return {
      paginas: (extra.lista || []).map((p) => (p.branco
        ? { branco: true, rotacao: p.rotacao || 0 }
        : { arquivo: p.arquivo, pagina: p.pagina, rotacao: p.rotacao || 0 })),
    };
  }
  return {};
}

/* ---------------- cartão de página ---------------- */

function CartaoPagina({ chave, url, pagina, proporcao, largura, rotacao = 0, marcada, removida, branca, origem, acoes, aoClicar, arrastavel }) {
  const deitada = Math.abs(rotacao % 180) === 90;
  const prop = deitada ? 1 / proporcao : proporcao;
  return html`<div class=${cx('cartao-pagina', marcada && 'marcada', removida && 'removida', branca && 'branca')}
      data-id=${arrastavel ? chave : undefined} style=${`--proporcao:${prop}`}
      onClick=${aoClicar} role=${aoClicar ? 'button' : undefined} tabIndex=${aoClicar ? 0 : undefined}
      onKeyDown=${(e) => { if (aoClicar && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); aoClicar(e); } }}
      aria-pressed=${aoClicar ? Boolean(marcada || removida) : undefined}>
    ${(marcada || removida) && html`<span class="marca-canto"><${Icone} nome=${removida ? 'x' : 'check'} tam=${13} espessura=${3} /></span>`}
    ${acoes && html`<div class="acoes-pagina" onClick=${(e) => e.stopPropagation()}>${acoes}</div>`}
    <div class="folha">
      <div class="folha-gira" style=${`transform:rotate(${rotacao}deg)${deitada ? ` scale(${Math.min(proporcao, 1 / proporcao)})` : ''}`}>
        ${branca
          ? html`<div class="papel-branco" style=${`aspect-ratio:${1 / proporcao}`}>em branco</div>`
          : html`<${Miniatura} url=${url} pagina=${pagina} largura=${largura} />`}
      </div>
    </div>
    <span class="numero">${branca ? 'Branca' : pagina}</span>
    ${origem && html`<span class="origem">${origem}</span>`}
  </div>`;
}

/* ---------------- grupo de páginas de um arquivo (seleção e giro) ---------------- */

function GrupoArquivo({ arquivo: a, modo, extra, setExtra, largura, aoRemover, aoSenha, varios }) {
  const tam = useTamanhos(a);
  const ultimo = useRef(null);
  const url = `/api/arquivos/${a.id}/pdf`;
  const sel = new Set((extra.selecao || {})[a.id] || []);
  const rot = (extra.rotacoes || {})[a.id] || {};

  const definirSelecao = (conjunto) => setExtra((x) => ({ ...x, selecao: { ...(x.selecao || {}), [a.id]: Array.from(conjunto).sort((p, q) => p - q) } }));
  const girar = (pagina, delta) => setExtra((x) => {
    const r = { ...((x.rotacoes || {})[a.id] || {}) };
    r[pagina] = (((r[pagina] || 0) + delta) % 360 + 360) % 360;
    return { ...x, rotacoes: { ...(x.rotacoes || {}), [a.id]: r } };
  });

  const clicar = (n, e) => {
    if (modo === 'girar') { girar(n, 90); return; }
    const novo = new Set(sel);
    if (e && e.shiftKey && ultimo.current) {
      const [ini, fim] = [Math.min(ultimo.current, n), Math.max(ultimo.current, n)];
      const ligar = !sel.has(n);
      for (let i = ini; i <= fim; i += 1) { if (ligar) novo.add(i); else novo.delete(i); }
    } else if (novo.has(n)) novo.delete(n); else novo.add(n);
    ultimo.current = n;
    definirSelecao(novo);
  };

  return html`<div class="grupo-arquivo">
    ${varios && html`<div class="grupo-arquivo-cab">
      <${Icone} nome="arquivo" tam=${17} /><span>${a.nome}</span>
      <small>${a.paginas ? plural(a.paginas, 'página', 'páginas') : ''}</small>
      <${SeloEstado} a=${a} aoSenha=${aoSenha} />
      <span style="margin-left:auto;display:flex;gap:4px">
        ${a.estado === 'pronto' && html`<button class="btn-icone p" title="Ver o documento" onClick=${() => abrirVisualizador({ titulo: a.nome, url })}><${Icone} nome="olho" tam=${16} /></button>`}
        <button class="btn-icone p" title="Tirar da lista" onClick=${() => aoRemover(a.id)}><${Icone} nome="x" tam=${16} /></button>
      </span>
    </div>`}
    ${a.estado !== 'pronto'
      ? html`<div class="miniatura-vazia" style="padding:30px">${a.estado === 'preparando' ? html`<${Anel} tam="m" />Preparando...` : a.erro}</div>`
      : html`<div class="grade-paginas" data-tamanho=${largura}>
          ${Array.from({ length: a.paginas }, (_, i) => i + 1).map((n) => {
            const t = tam && tam[n - 1];
            return html`<${CartaoPagina} key=${n} url=${url} pagina=${n} largura=${largura}
              proporcao=${t ? t.altura / t.largura : 1.414} rotacao=${rot[n] || 0}
              marcada=${modo === 'selecionar' && sel.has(n)} removida=${modo === 'remover' && sel.has(n)}
              aoClicar=${(e) => clicar(n, e)}
              acoes=${modo === 'girar' && html`
                <button class="btn-icone p" title="Girar para a esquerda" onClick=${() => girar(n, -90)}><${Icone} nome="girarEsquerda" tam=${15} /></button>
                <button class="btn-icone p" title="Girar para a direita" onClick=${() => girar(n, 90)}><${Icone} nome="girarDireita" tam=${15} /></button>`} />`;
          })}
        </div>`}
  </div>`;
}

/* ---------------- organizar: todas as páginas numa grade só ---------------- */

let contadorChave = 0;
const novaChave = () => `p${(contadorChave += 1)}`;

function GradeOrganizar({ arquivos, extra, setExtra, largura }) {
  const grade = useRef(null);
  const lista = extra.lista || [];
  const porId = new Map(arquivos.map((a) => [a.id, a]));
  const tamanhosPorArquivo = useTamanhosVarios(arquivos);

  // Páginas de arquivos novos entram no fim; de arquivos removidos saem.
  useEffect(() => {
    const prontos = arquivos.filter((a) => a.estado === 'pronto');
    const incluidos = new Set(extra.incluidos || []);
    const ids = new Set(arquivos.map((a) => a.id));
    let nova = lista.filter((p) => p.branco || ids.has(p.arquivo));
    let mudou = nova.length !== lista.length;
    for (const a of prontos) {
      if (incluidos.has(a.id)) continue;
      incluidos.add(a.id);
      mudou = true;
      for (let n = 1; n <= a.paginas; n += 1) nova = nova.concat({ chave: novaChave(), arquivo: a.id, pagina: n, rotacao: 0 });
    }
    if (mudou) setExtra((x) => ({ ...x, lista: nova, incluidos: Array.from(incluidos) }));
  }, [arquivos.map((a) => `${a.id}:${a.estado}`).join('|')]);

  const ordem = lista.map((p) => p.chave);
  useOrdenavel({
    container: grade,
    ordem,
    aoMudar: (nova) => setExtra((x) => {
      const porChave = new Map((x.lista || []).map((p) => [p.chave, p]));
      return { ...x, lista: nova.map((k) => porChave.get(k)).filter(Boolean) };
    }),
    ativo: lista.length > 1,
  });

  const alterar = (chave, fn) => setExtra((x) => ({ ...x, lista: (x.lista || []).flatMap((p) => (p.chave === chave ? fn(p) : [p])) }));
  const branca = () => ({ chave: novaChave(), branco: true, rotacao: 0 });

  return html`<div class="grade-paginas" ref=${grade}>
    ${lista.map((p, i) => {
      const a = p.branco ? null : porId.get(p.arquivo);
      const t = a && tamanhosPorArquivo[a.id] && tamanhosPorArquivo[a.id][p.pagina - 1];
      const anterior = lista.slice(0, i).reverse().find((q) => !q.branco);
      const tAnt = anterior && tamanhosPorArquivo[anterior.arquivo] && tamanhosPorArquivo[anterior.arquivo][anterior.pagina - 1];
      const proporcao = t ? t.altura / t.largura : tAnt ? tAnt.altura / tAnt.largura : 1.414;
      return html`<${CartaoPagina} key=${p.chave} chave=${p.chave} arrastavel=${true}
        url=${a ? `/api/arquivos/${a.id}/pdf` : null} pagina=${p.pagina} largura=${largura} proporcao=${proporcao}
        rotacao=${p.rotacao || 0} branca=${p.branco}
        origem=${arquivos.length > 1 && a ? semExtensao(a.nome) : null}
        acoes=${html`
          <button class="btn-icone p" title="Girar para a esquerda" onClick=${() => alterar(p.chave, (q) => [{ ...q, rotacao: ((q.rotacao || 0) + 270) % 360 }])}><${Icone} nome="girarEsquerda" tam=${15} /></button>
          <button class="btn-icone p" title="Girar para a direita" onClick=${() => alterar(p.chave, (q) => [{ ...q, rotacao: ((q.rotacao || 0) + 90) % 360 }])}><${Icone} nome="girarDireita" tam=${15} /></button>
          <button class="btn-icone p" title="Duplicar" onClick=${() => alterar(p.chave, (q) => [q, { ...q, chave: novaChave() }])}><${Icone} nome="copiar" tam=${15} /></button>
          <button class="btn-icone p" title="Página em branco depois desta" onClick=${() => alterar(p.chave, (q) => [q, branca()])}><${Icone} nome="paginaBranca" tam=${15} /></button>
          <button class="btn-icone p perigo" title="Apagar esta página" onClick=${() => alterar(p.chave, () => [])}><${Icone} nome="lixo" tam=${15} /></button>`} />`;
    })}
  </div>`;
}

/* ============================================================
   ÁREA DE PÁGINAS
   ============================================================ */

const LARGURAS = { p: 108, m: 148, g: 210 };
const LARGURAS_CELULAR = { p: 72, m: 98, g: 150 };

export function AreaPaginas({ ferramenta: f, arquivos, extra, setExtra, aoRemover, aoAdicionar, aoSenha }) {
  const modo = f.modoPaginas;
  const [tam, setTam] = useState(() => preferencias.ler('tamanho-paginas', 'm'));
  const [texto, setTexto] = useState('');
  const estreito = useEstreito();
  const largura = (estreito ? LARGURAS_CELULAR : LARGURAS)[tam] || LARGURAS.m;
  const prontos = arquivos.filter((a) => a.estado === 'pronto');
  const unico = prontos.length === 1 ? prontos[0] : null;

  const trocarTamanho = (t) => { setTam(t); preferencias.gravar('tamanho-paginas', t); };

  // aplica a mesma regra a todos os arquivos
  const selecionarTodos = (regra) => setExtra((x) => {
    const selecao = { ...(x.selecao || {}) };
    for (const a of prontos) {
      const atual = new Set(selecao[a.id] || []);
      const nova = [];
      for (let n = 1; n <= a.paginas; n += 1) if (regra(n, atual.has(n))) nova.push(n);
      selecao[a.id] = nova;
    }
    return { ...x, selecao };
  });

  const girarTodas = (delta) => setExtra((x) => {
    const rotacoes = { ...(x.rotacoes || {}) };
    for (const a of prontos) {
      const r = { ...(rotacoes[a.id] || {}) };
      for (let n = 1; n <= a.paginas; n += 1) r[n] = (((r[n] || 0) + delta) % 360 + 360) % 360;
      rotacoes[a.id] = r;
    }
    return { ...x, rotacoes };
  });

  // o campo de intervalo acompanha a seleção quando há um arquivo só
  useEffect(() => {
    if (!unico || (modo !== 'remover' && modo !== 'selecionar')) return;
    if (document.activeElement && document.activeElement.id === 'campo-intervalo') return;
    setTexto(paraTexto((extra.selecao || {})[unico.id] || []));
  }, [extra.selecao, unico && unico.id]);

  const aplicarTexto = (t) => {
    setTexto(t);
    if (!unico) return;
    const set = paraConjunto(t, unico.paginas);
    setExtra((x) => ({ ...x, selecao: { ...(x.selecao || {}), [unico.id]: Array.from(set).sort((p, q) => p - q) } }));
  };

  const barraTamanho = html`<div class="segmentado tamanho" style="width:auto" role="radiogroup" aria-label="Tamanho das miniaturas">
    ${['p', 'm', 'g'].map((t) => html`<button key=${t} class=${cx(tam === t && 'ativo')} onClick=${() => trocarTamanho(t)} title=${t === 'p' ? 'Pequenas' : t === 'm' ? 'Médias' : 'Grandes'}>${t.toUpperCase()}</button>`)}
  </div>`;

  let barra;
  if (modo === 'remover' || modo === 'selecionar') {
    barra = html`<div class="barra-selecao">
      <button class="btn btn-p btn-fantasma" onClick=${() => selecionarTodos(() => true)}><${Icone} nome="selecionarTudo" tam=${15} /> Todas</button>
      <button class="btn btn-p btn-fantasma" onClick=${() => selecionarTodos(() => false)}>Nenhuma</button>
      <button class="btn btn-p btn-fantasma" onClick=${() => selecionarTodos((n) => n % 2 === 1)}>Ímpares</button>
      <button class="btn btn-p btn-fantasma" onClick=${() => selecionarTodos((n) => n % 2 === 0)}>Pares</button>
      <button class="btn btn-p btn-fantasma" onClick=${() => selecionarTodos((n, tem) => !tem)}><${Icone} nome="inverter" tam=${15} /> Inverter</button>
      ${unico && html`<span class="sep"></span><input id="campo-intervalo" class="entrada" type="text" inputmode="numeric" placeholder="ou digite: 1-3, 7" value=${texto}
        onInput=${(e) => aplicarTexto(e.currentTarget.value)} aria-label="Páginas por intervalo" />`}
      ${barraTamanho}
    </div>`;
  } else if (modo === 'girar') {
    barra = html`<div class="barra-selecao">
      <button class="btn btn-p" onClick=${() => girarTodas(-90)}><${Icone} nome="girarEsquerda" tam=${16} /> Girar todas</button>
      <button class="btn btn-p" onClick=${() => girarTodas(90)}><${Icone} nome="girarDireita" tam=${16} /> Girar todas</button>
      <button class="btn btn-p btn-fantasma" onClick=${() => setExtra((x) => ({ ...x, rotacoes: {} }))}>Desfazer</button>
      ${barraTamanho}
    </div>`;
  } else {
    barra = html`<div class="barra-selecao">
      <button class="btn btn-p" onClick=${aoAdicionar}><${Icone} nome="mais" tam=${16} /> Arquivo</button>
      <button class="btn btn-p" onClick=${() => setExtra((x) => ({ ...x, lista: [...(x.lista || []), { chave: novaChave(), branco: true, rotacao: 0 }] }))}><${Icone} nome="paginaBranca" tam=${16} /> Página em branco</button>
      <button class="btn btn-p btn-fantasma" onClick=${() => setExtra((x) => ({ ...x, lista: (x.lista || []).slice().reverse() }))}><${Icone} nome="inverter" tam=${15} /> Inverter</button>
      <button class="btn btn-p btn-fantasma" title="Volta a ordem original" onClick=${() => setExtra((x) => ({ ...x, lista: [], incluidos: [] }))}><${Icone} nome="recarregar" tam=${15} /> Recomeçar</button>
      ${barraTamanho}
    </div>`;
  }

  const dica = modo === 'remover' ? 'Clique nas páginas que devem sair (Shift + clique marca um trecho).'
    : modo === 'selecionar' ? 'Clique nas páginas que quer levar (Shift + clique marca um trecho).'
    : modo === 'girar' ? 'Clique numa página para girá-la, ou use os botões dela.'
    : `Arraste as páginas para mudar a ordem${'ontouchstart' in window ? ' (segure e arraste)' : ''}. Passe o mouse para girar, duplicar ou apagar.`;

  return html`<div>
    ${barra}
    <p style="color:var(--texto-3);font-size:12.5px;margin:-4px 0 14px">${dica}</p>
    <div style=${`--tam-pagina:${largura}px`}>
      ${modo === 'organizar'
        ? html`<${GradeOrganizar} arquivos=${arquivos} extra=${extra} setExtra=${setExtra} largura=${largura} />`
        : arquivos.map((a) => html`<${GrupoArquivo} key=${a.id} arquivo=${a} modo=${modo} extra=${extra} setExtra=${setExtra}
            largura=${largura} aoRemover=${aoRemover} aoSenha=${aoSenha} varios=${true} />`)}
    </div>
    ${modo !== 'organizar' && html`<button class="btn" onClick=${aoAdicionar}><${Icone} nome="mais" tam=${16} /> Adicionar outro PDF</button>`}
  </div>`;
}
