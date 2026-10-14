import { html, useState, useEffect, useRef, useLayoutEffect, cx, plural } from '../lib.js';
import { Icone } from '../icones.js';
import { Miniatura, desenharEm, tamanhos as lerTamanhos } from '../pdfvisual.js';
import { api, avisar } from '../loja.js';
import { Alerta, Anel } from './base.js';
import { Alternar, Segmentado } from './opcoes.js';
import { DialogoAssinatura, useAssinaturas, carregarAssinatura } from './assinatura.js';

/* ============================================================
   Editor visual: assinar, editar, tarjar e recortar
   ============================================================ */

let contador = 0;
const novoId = () => `e${Date.now().toString(36)}${(contador += 1)}`;

const limitar = (v, a, b) => Math.min(Math.max(v, a), b);

/** Mede texto (em pontos) do jeito que o servidor vai desenhar. */
const medidor = document.createElement('canvas').getContext('2d');
const FAMILIAS = { sans: 'Arial, Helvetica, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };

function medirTexto(el) {
  medidor.font = `${el.negrito ? 'bold ' : ''}${el.tamanho}px ${FAMILIAS[el.fonte || 'sans']}`;
  const linhas = String(el.texto || ' ').split('\n');
  const largura = Math.max(...linhas.map((l) => medidor.measureText(l || ' ').width));
  return { largura: largura + el.tamanho * 0.2, altura: linhas.length * el.tamanho * 1.2 };
}

function hoje() {
  return new Date().toLocaleDateString('pt-BR');
}

/* ---------------- tamanho das páginas ---------------- */

function useTamanhosPagina(arquivo) {
  const [lista, setLista] = useState(null);
  const url = arquivo && arquivo.estado === 'pronto' ? `/api/arquivos/${arquivo.id}/pdf` : null;
  useEffect(() => {
    if (!url) return undefined;
    let vivo = true;
    lerTamanhos(url).then((t) => { if (vivo) setLista(t); }).catch(() => {});
    return () => { vivo = false; };
  }, [url]);
  return lista;
}

/* ---------------- página grande ---------------- */

function FolhaGrande({ url, pagina, largura, altura, children, modoDesenho, aoApertar, folhaRef, escala }) {
  const canvas = useRef(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    if (canvas.current && largura > 0) {
      desenharEm(canvas.current, url, pagina, largura).then(() => { if (vivo) setCarregando(false); }).catch(() => {});
    }
    return () => { vivo = false; };
  }, [url, pagina, Math.round(largura)]);

  return html`<div class=${cx('editor-folha', modoDesenho && 'modo-desenho')} ref=${folhaRef}
      style=${`width:${largura}px;height:${altura}px;--escala:${escala}`}
      onPointerDown=${aoApertar}>
    <canvas ref=${canvas} style=${`width:${largura}px;height:${altura}px`}></canvas>
    ${carregando && html`<div style="position:absolute;inset:0;display:grid;place-items:center"><${Anel} /></div>`}
    ${children}
  </div>`;
}

/* ---------------- um elemento sobre a página ---------------- */

const ALCAS = ['no', 'ne', 'so', 'se', 'n', 's', 'l', 'o'];

function Elemento({ el, selecionado, aoSelecionar, aoMudar, aoApagar, aoDuplicar, folhaRef, modo }) {
  const iniciar = (e, tipo) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    aoSelecionar(el.id);
    const folha = folhaRef.current.getBoundingClientRect();
    const ini = { x: e.clientX, y: e.clientY, el: { ...el } };
    const alvo = e.currentTarget;
    try { alvo.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    const travarProporcao = el.tipo === 'imagem' && tipo.length === 2;
    const proporcao = ini.el.h / ini.el.w;

    const mover = (ev) => {
      const dx = (ev.clientX - ini.x) / folha.width;
      const dy = (ev.clientY - ini.y) / folha.height;
      let { x, y, w, h } = ini.el;
      if (tipo === 'mover') {
        x = limitar(x + dx, -w * 0.5, 1 - w * 0.5);
        y = limitar(y + dy, -h * 0.5, 1 - h * 0.5);
      } else {
        if (tipo.includes('o')) { x = Math.min(x + dx, x + w - 0.01); w = ini.el.w - (x - ini.el.x); }
        if (tipo.includes('l') || tipo === 'ne' || tipo === 'se') w = Math.max(0.01, w + dx);
        if (tipo === 'n' || tipo === 'no' || tipo === 'ne') { y = Math.min(y + dy, y + h - 0.01); h = ini.el.h - (y - ini.el.y); }
        if (tipo === 's' || tipo === 'so' || tipo === 'se') h = Math.max(0.01, h + dy);
        if (travarProporcao) {
          // proporção em coordenadas normalizadas: a escala da folha não muda
          const novoH = w * proporcao;
          if (tipo === 'no' || tipo === 'ne') y = ini.el.y + ini.el.h - novoH;
          h = novoH;
        }
      }
      aoMudar(el.id, { x, y, w, h });
    };
    const soltar = () => {
      alvo.removeEventListener('pointermove', mover);
      alvo.removeEventListener('pointerup', soltar);
      alvo.removeEventListener('pointercancel', soltar);
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerup', soltar);
    alvo.addEventListener('pointercancel', soltar);
  };

  const estilo = `left:${el.x * 100}%;top:${el.y * 100}%;width:${el.w * 100}%;height:${el.h * 100}%`;
  let corpo = null;
  let classe = 'editor-elemento';
  if (el.tipo === 'imagem') corpo = html`<img src=${el.imagem} alt="" draggable="false" />`;
  else if (el.tipo === 'texto') {
    corpo = html`<div class="texto-el" style=${`font-size:calc(var(--escala) * ${el.tamanho}px);color:${el.cor || '#111'};font-weight:${el.negrito ? 700 : 400};font-family:${FAMILIAS[el.fonte || 'sans']};${el.fundo ? `background:${el.fundo};` : ''}`}>${el.texto}</div>`;
  } else if (el.tipo === 'tarja') classe += ` tarja${el.sugerida ? ' sugerida' : ''}`;
  else if (el.tipo === 'recorte') classe += ' recorte';
  else if (el.variante === 'branco') classe += ' branco';
  if (el.tipo === 'retangulo' && el.variante !== 'branco') {
    corpo = html`<div style=${`position:absolute;inset:0;background:${el.fundo || 'transparent'};opacity:${el.opacidade != null ? el.opacidade : 1};${el.borda ? `outline:2px solid ${el.borda};outline-offset:-2px;` : ''}`}></div>`;
  }

  return html`<div class=${cx(classe, selecionado && 'selecionado')} style=${estilo}
      onPointerDown=${(e) => iniciar(e, 'mover')} data-elemento=${el.id}>
    ${corpo}
    ${selecionado && ALCAS.map((a) => html`<span key=${a} class=${`alca ${a}`} onPointerDown=${(e) => iniciar(e, a)}></span>`)}
    ${selecionado && modo !== 'recortar' && html`<div class="remover-el" onPointerDown=${(e) => e.stopPropagation()}>
      ${aoDuplicar && html`<button class="btn-icone p" style="background:var(--superficie);box-shadow:var(--sombra-2)" title="Duplicar (Ctrl+D)" onClick=${() => aoDuplicar(el.id)}><${Icone} nome="copiar" tam=${14} /></button>`}
      <button class="btn-icone p perigo" style="background:var(--superficie);box-shadow:var(--sombra-2)" title="Apagar (Delete)" onClick=${() => aoApagar(el.id)}><${Icone} nome="lixo" tam=${14} /></button>
    </div>`}
  </div>`;
}

/* ============================================================
   EDITOR
   ============================================================ */

const PADROES = [
  { id: 'cpf', rotulo: 'CPF' }, { id: 'cnpj', rotulo: 'CNPJ' }, { id: 'rg', rotulo: 'RG' },
  { id: 'email', rotulo: 'E-mail' }, { id: 'telefone', rotulo: 'Telefone' }, { id: 'cep', rotulo: 'CEP' }, { id: 'data', rotulo: 'Datas' },
];

export function Editor({ ferramenta: f, arquivo, extra, setExtra, aoTrocar, botao, problema }) {
  const modo = f.modoEditor;
  const url = `/api/arquivos/${arquivo.id}/pdf`;
  const tamanhos = useTamanhosPagina(arquivo);
  const [pagina, setPagina] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState(null);
  const [ferramentaAtiva, setFerramentaAtiva] = useState(modo === 'tarjar' ? 'tarja' : 'mover');
  const [dialogo, setDialogo] = useState(false);
  const [largPalco, setLargPalco] = useState(700);
  const [desenho, setDesenho] = useState(null);
  const [busca, setBusca] = useState({ termo: '', padroes: ['cpf'] });
  const [procurando, setProcurando] = useState(false);
  const palco = useRef(null);
  const folhaRef = useRef(null);
  const entradaImagem = useRef(null);
  const assinaturas = useAssinaturas();

  const elementos = extra.elementos || [];
  const total = arquivo.paginas || 1;
  const tam = tamanhos && tamanhos[pagina - 1] ? tamanhos[pagina - 1] : { largura: arquivo.largura || 595, altura: arquivo.altura || 842 };

  // largura disponível no palco
  useLayoutEffect(() => {
    const el = palco.current;
    if (!el) return undefined;
    const medir = () => setLargPalco(el.clientWidth - 40);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const larguraFolha = Math.max(200, Math.min(largPalco, 980) * zoom);
  const alturaFolha = larguraFolha * (tam.altura / tam.largura);
  const escala = larguraFolha / tam.largura; // pixels por ponto

  // recorte começa com uma margem pequena em toda a volta
  useEffect(() => {
    if (modo === 'recortar' && !extra.recorte) {
      setExtra((x) => ({ ...x, recorte: { x: 0.06, y: 0.06, w: 0.88, h: 0.88, pagina: 1 }, aplicarEm: x.aplicarEm || 'todas' }));
    }
  }, [modo]);
  useEffect(() => {
    if (modo === 'recortar' && extra.recorte && extra.recorte.pagina !== pagina) {
      setExtra((x) => ({ ...x, recorte: { ...x.recorte, pagina } }));
    }
  }, [pagina]);

  /* ---------------- alterar elementos ---------------- */

  const definir = (fn) => setExtra((x) => ({ ...x, elementos: fn(x.elementos || []) }));
  const adicionar = (el) => {
    const novo = { id: novoId(), pagina, ...el };
    definir((lista) => [...lista, novo]);
    setSel(novo.id);
    return novo;
  };
  const mudar = (id, campos) => {
    if (id === 'recorte') { setExtra((x) => ({ ...x, recorte: { ...x.recorte, ...campos } })); return; }
    definir((lista) => lista.map((e) => (e.id === id ? { ...e, ...campos } : e)));
  };
  const apagar = (id) => { definir((lista) => lista.filter((e) => e.id !== id)); setSel(null); };
  const duplicar = (id) => {
    const el = elementos.find((e) => e.id === id);
    if (!el) return;
    const copia = { ...el, id: novoId(), x: limitar(el.x + 0.03, 0, 1 - el.w), y: limitar(el.y + 0.03, 0, 1 - el.h) };
    definir((lista) => [...lista, copia]);
    setSel(copia.id);
  };

  const selecionado = elementos.find((e) => e.id === sel) || null;

  // texto muda de tamanho conforme o conteúdo
  const ajustarTexto = (el) => {
    const m = medirTexto(el);
    return { ...el, w: m.largura / tam.largura, h: m.altura / tam.altura };
  };

  const inserirImagem = (dataUrl, largura, altura, extraCampos = {}) => {
    const w = 0.3;
    const h = w * (altura / largura) * (tam.largura / tam.altura);
    adicionar({ tipo: 'imagem', imagem: dataUrl, x: 0.5 - w / 2, y: limitar(0.75 - h / 2, 0, 1 - h), w, h, ...extraCampos });
    setFerramentaAtiva('mover');
  };

  const inserirTexto = (texto, campos = {}) => {
    const base = ajustarTexto({ tipo: 'texto', texto, tamanho: 12, cor: '#111111', fonte: 'sans', negrito: false, ...campos });
    // sem posição definida (clique na página), entra no centro, mais para baixo
    if (campos.x === undefined) { base.x = 0.5 - base.w / 2; base.y = 0.7; }
    adicionar(base);
    setFerramentaAtiva('mover');
  };

  /* ---------------- desenhar retângulos (tarja, branco, destaque...) ---------------- */

  const desenhaArrastando = ['tarja', 'retangulo', 'branco', 'destaque'].includes(ferramentaAtiva);

  const apertarFolha = (e) => {
    if (e.target.closest('[data-elemento]')) return;
    const folha = folhaRef.current.getBoundingClientRect();
    const px = (e.clientX - folha.left) / folha.width;
    const py = (e.clientY - folha.top) / folha.height;
    if (ferramentaAtiva === 'texto') {
      inserirTexto('Texto', { x: limitar(px, 0, 0.95), y: limitar(py, 0, 0.97) });
      return;
    }
    if (!desenhaArrastando) { setSel(null); return; }
    e.preventDefault();
    const alvo = e.currentTarget;
    try { alvo.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    const inicio = { x: px, y: py };
    setDesenho({ x: px, y: py, w: 0, h: 0 });
    const mover = (ev) => {
      const qx = limitar((ev.clientX - folha.left) / folha.width, 0, 1);
      const qy = limitar((ev.clientY - folha.top) / folha.height, 0, 1);
      setDesenho({ x: Math.min(inicio.x, qx), y: Math.min(inicio.y, qy), w: Math.abs(qx - inicio.x), h: Math.abs(qy - inicio.y) });
    };
    const soltar = (ev) => {
      alvo.removeEventListener('pointermove', mover);
      alvo.removeEventListener('pointerup', soltar);
      alvo.removeEventListener('pointercancel', soltar);
      const qx = limitar((ev.clientX - folha.left) / folha.width, 0, 1);
      const qy = limitar((ev.clientY - folha.top) / folha.height, 0, 1);
      const caixa = { x: Math.min(inicio.x, qx), y: Math.min(inicio.y, qy), w: Math.abs(qx - inicio.x), h: Math.abs(qy - inicio.y) };
      setDesenho(null);
      if (caixa.w < 0.008 || caixa.h < 0.004) return;
      if (ferramentaAtiva === 'tarja') adicionar({ tipo: 'tarja', ...caixa });
      else if (ferramentaAtiva === 'branco') adicionar({ tipo: 'retangulo', variante: 'branco', fundo: '#ffffff', ...caixa });
      else if (ferramentaAtiva === 'destaque') adicionar({ tipo: 'retangulo', variante: 'destaque', fundo: '#ffe600', opacidade: 0.35, ...caixa });
      else adicionar({ tipo: 'retangulo', variante: 'caixa', borda: '#d92d20', espessura: 2, ...caixa });
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerup', soltar);
    alvo.addEventListener('pointercancel', soltar);
  };

  /* ---------------- teclado ---------------- */

  useEffect(() => {
    const f2 = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (sel && (e.key === 'Delete' || e.key === 'Backspace') && sel !== 'recorte') { e.preventDefault(); apagar(sel); }
      else if (sel && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel !== 'recorte') { e.preventDefault(); duplicar(sel); }
      else if (e.key === 'Escape') setSel(null);
      else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const el = sel === 'recorte' ? extra.recorte : elementos.find((x) => x.id === sel);
        if (!el) return;
        const p = e.shiftKey ? 0.02 : 0.003;
        const d = { ArrowLeft: [-p, 0], ArrowRight: [p, 0], ArrowUp: [0, -p], ArrowDown: [0, p] }[e.key];
        mudar(sel, { x: el.x + d[0], y: el.y + d[1] });
      } else if (!sel && (e.key === 'PageDown' || e.key === 'ArrowRight')) setPagina((n) => Math.min(total, n + 1));
      else if (!sel && (e.key === 'PageUp' || e.key === 'ArrowLeft')) setPagina((n) => Math.max(1, n - 1));
    };
    window.addEventListener('keydown', f2);
    return () => window.removeEventListener('keydown', f2);
  });

  /* ---------------- tarja automática ---------------- */

  const procurar = async () => {
    if (!busca.termo.trim() && !busca.padroes.length) { avisar('Digite um termo ou marque o que procurar.', 'aviso'); return; }
    setProcurando(true);
    try {
      const d = await api.post(`/arquivos/${arquivo.id}/localizar`, {
        termos: busca.termo.split(/[;\n]/).map((t) => t.trim()).filter(Boolean),
        padroes: busca.padroes,
      });
      if (!d.achados.length) { avisar('Nada encontrado no texto do PDF. Se ele for digitalizado, passe no OCR antes.', 'aviso'); return; }
      const ja = new Set(elementos.filter((e) => e.tipo === 'tarja').map((e) => `${e.pagina}:${e.x.toFixed(3)}:${e.y.toFixed(3)}`));
      const novos = d.achados
        .filter((a) => !ja.has(`${a.pagina}:${a.x.toFixed(3)}:${a.y.toFixed(3)}`))
        .map((a) => ({ id: novoId(), tipo: 'tarja', pagina: a.pagina, x: a.x, y: a.y, w: a.w, h: a.h, texto: a.texto }));
      definir((lista) => [...lista, ...novos]);
      const paginas = new Set(novos.map((n) => n.pagina));
      avisar(`${plural(novos.length, 'trecho encontrado', 'trechos encontrados')} em ${plural(paginas.size, 'página', 'páginas')}. Confira antes de aplicar.`, 'ok');
      if (novos.length && !paginas.has(pagina)) setPagina(Math.min(...paginas));
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setProcurando(false);
    }
  };

  /* ---------------- partes da tela ---------------- */

  const contagemPorPagina = {};
  for (const e of elementos) {
    if (e.todas) for (let n = 1; n <= total; n += 1) contagemPorPagina[n] = (contagemPorPagina[n] || 0) + 1;
    else contagemPorPagina[e.pagina] = (contagemPorPagina[e.pagina] || 0) + 1;
  }

  const miniaturas = html`<div class="editor-miniaturas" aria-label="Páginas">
    ${Array.from({ length: total }, (_, i) => i + 1).map((n) => html`<button key=${n} class=${cx(n === pagina && 'ativo')} onClick=${() => { setPagina(n); setSel(null); }}>
      <span class="folha-mini"><${Miniatura} url=${url} pagina=${n} largura=${110} />${contagemPorPagina[n] ? html`<span class="marcas-mini">${contagemPorPagina[n]}</span>` : ''}</span>
      ${n}
    </button>`)}
  </div>`;

  const naPagina = elementos.filter((e) => e.todas || e.pagina === pagina);
  const recorteAqui = modo === 'recortar' && extra.recorte ? { ...extra.recorte, id: 'recorte', tipo: 'recorte' } : null;

  const palcoEl = html`<div class="editor-palco" ref=${palco}>
    <div class="editor-palco-dentro">
      <${FolhaGrande} url=${url} pagina=${pagina} largura=${larguraFolha} altura=${alturaFolha} escala=${escala}
        folhaRef=${folhaRef} modoDesenho=${desenhaArrastando || ferramentaAtiva === 'texto'} aoApertar=${apertarFolha}>
        ${naPagina.map((el) => html`<${Elemento} key=${el.id} el=${el} selecionado=${sel === el.id} aoSelecionar=${setSel}
          aoMudar=${mudar} aoApagar=${apagar} aoDuplicar=${duplicar} folhaRef=${folhaRef} modo=${modo} />`)}
        ${recorteAqui && html`<${Elemento} el=${recorteAqui} selecionado=${true} aoSelecionar=${() => setSel('recorte')}
          aoMudar=${mudar} aoApagar=${() => {}} folhaRef=${folhaRef} modo=${modo} />`}
        ${desenho && html`<div class="desenhando-retangulo" style=${`left:${desenho.x * 100}%;top:${desenho.y * 100}%;width:${desenho.w * 100}%;height:${desenho.h * 100}%;${ferramentaAtiva === 'tarja' ? 'background:rgba(0,0,0,.6)' : ''}`}></div>`}
      </${FolhaGrande}>
    </div>
  </div>`;

  /* ---------------- painel ---------------- */

  const navPaginas = html`<div style="display:flex;align-items:center;gap:6px">
    <button class="btn-icone" disabled=${pagina <= 1} onClick=${() => setPagina(pagina - 1)} aria-label="Página anterior"><${Icone} nome="esquerda" /></button>
    <span style="font-size:13px;font-weight:600;min-width:84px;text-align:center">Página ${pagina} de ${total}</span>
    <button class="btn-icone" disabled=${pagina >= total} onClick=${() => setPagina(pagina + 1)} aria-label="Próxima página"><${Icone} nome="direita" /></button>
    <span style="flex:1"></span>
    <div class="zoom-controle">
      <button class="btn-icone p" onClick=${() => setZoom((z) => Math.max(0.5, z - 0.15))} aria-label="Diminuir"><${Icone} nome="zoomMenos" tam=${15} /></button>
      <span>${Math.round(zoom * 100)}%</span>
      <button class="btn-icone p" onClick=${() => setZoom((z) => Math.min(3, z + 0.15))} aria-label="Ampliar"><${Icone} nome="zoomMais" tam=${15} /></button>
    </div>
  </div>`;

  const botaoFerr = (id, icone, rotulo) => html`<button class=${cx(ferramentaAtiva === id && 'ativo')} onClick=${() => { setFerramentaAtiva(id); if (id !== 'mover') setSel(null); }}>
    <${Icone} nome=${icone} tam=${18} />${rotulo}
  </button>`;

  let painel;
  if (modo === 'assinar') {
    painel = html`
      <div class="campo">
        <span class="rotulo">Sua assinatura</span>
        <button class="btn btn-primario btn-bloco" onClick=${() => setDialogo(true)}><${Icone} nome="assinar" tam=${17} /> Criar assinatura</button>
      </div>
      ${assinaturas.lista.length > 0 && html`<div class="campo">
        <span class="rotulo">Guardadas — toque para colocar</span>
        <div class="assinaturas-guardadas">
          ${assinaturas.lista.map((a) => html`<div class="assinatura-guardada" key=${a.id} role="button" tabIndex="0" title="Colocar na página"
              onClick=${async () => { const r = await carregarAssinatura(a.id); inserirImagem(r.dataUrl, r.largura, r.altura, { variante: 'assinatura' }); }}>
            <img src=${`/api/assinaturas/${a.id}`} alt="Assinatura guardada" />
            <button class="btn-icone p apagar" title="Apagar esta assinatura" onClick=${async (e) => { e.stopPropagation(); await api.del(`/assinaturas/${a.id}`); assinaturas.recarregar(); }}><${Icone} nome="x" tam=${13} /></button>
          </div>`)}
        </div>
      </div>`}
      <div class="campo">
        <span class="rotulo">Também dá para colocar</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-p" onClick=${() => inserirTexto(hoje())}><${Icone} nome="calendario" tam=${15} /> Data de hoje</button>
          <button class="btn btn-p" onClick=${() => inserirTexto('Nome completo')}><${Icone} nome="letra" tam=${15} /> Texto</button>
          <button class="btn btn-p" onClick=${() => inserirTexto('X', { tamanho: 16, negrito: true })}><${Icone} nome="x" tam=${15} /> Marcar X</button>
        </div>
      </div>`;
  } else if (modo === 'editar') {
    painel = html`
      <div class="ferramentas-editor" role="toolbar" aria-label="Ferramentas">
        ${botaoFerr('mover', 'mao', 'Mover')}
        ${botaoFerr('texto', 'letra', 'Texto')}
        <button onClick=${() => entradaImagem.current && entradaImagem.current.click()}><${Icone} nome="imagem" tam=${18} />Imagem</button>
        ${botaoFerr('branco', 'borracha', 'Apagar')}
        ${botaoFerr('destaque', 'editar', 'Destacar')}
        ${botaoFerr('retangulo', 'quadrado', 'Caixa')}
      </div>
      <p class="ajuda" style="font-size:12px;color:var(--texto-3)">
        ${ferramentaAtiva === 'texto' ? 'Clique na página onde o texto deve ficar.'
          : ferramentaAtiva === 'branco' ? 'Arraste sobre o que quer cobrir com branco.'
          : ferramentaAtiva === 'destaque' ? 'Arraste sobre o trecho para destacar em amarelo.'
          : ferramentaAtiva === 'retangulo' ? 'Arraste para desenhar uma caixa.'
          : 'Clique num item para mover ou mudar o tamanho.'}
      </p>
      <input ref=${entradaImagem} type="file" accept="image/png,image/jpeg" hidden onChange=${(e) => {
        const arq = e.currentTarget.files[0];
        if (!arq) return;
        const leitor = new FileReader();
        leitor.onload = () => { const img = new Image(); img.onload = () => inserirImagem(leitor.result, img.width, img.height); img.src = leitor.result; };
        leitor.readAsDataURL(arq);
        e.currentTarget.value = '';
      }} />`;
  } else if (modo === 'tarjar') {
    const tarjas = elementos.filter((e) => e.tipo === 'tarja');
    painel = html`
      <div class="ferramentas-editor" style="grid-template-columns:1fr 1fr" role="toolbar">
        ${botaoFerr('tarja', 'quadrado', 'Desenhar tarja')}
        ${botaoFerr('mover', 'mao', 'Ajustar')}
      </div>
      <div class="campo">
        <span class="rotulo">Procurar e tarjar</span>
        <input class="entrada" type="text" placeholder="Nome, palavra ou trecho" value=${busca.termo}
          onInput=${(e) => setBusca({ ...busca, termo: e.currentTarget.value })}
          onKeyDown=${(e) => { if (e.key === 'Enter') procurar(); }} />
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${PADROES.map((p) => html`<button key=${p.id} class=${cx('filtro', busca.padroes.includes(p.id) && 'ativo')} style="height:28px;font-size:12px"
            onClick=${() => setBusca({ ...busca, padroes: busca.padroes.includes(p.id) ? busca.padroes.filter((x) => x !== p.id) : [...busca.padroes, p.id] })}>${p.rotulo}</button>`)}
        </div>
        <button class="btn btn-bloco" onClick=${procurar} disabled=${procurando}>${procurando ? html`<${Anel} tam="p" />` : html`<${Icone} nome="busca" tam=${16} />`} Encontrar no documento</button>
      </div>
      <div class="campo">
        <span class="rotulo">${plural(tarjas.length, 'tarja', 'tarjas')}</span>
        ${tarjas.length > 0 && html`<button class="btn btn-p btn-perigo" onClick=${() => { definir((l) => l.filter((e) => e.tipo !== 'tarja')); setSel(null); }}><${Icone} nome="lixo" tam=${15} /> Tirar todas</button>`}
      </div>
      <${Alternar} ligado=${Boolean(extra.ocr)} aoMudar=${(v) => setExtra((x) => ({ ...x, ocr: v }))}
        titulo="Manter o resto do texto pesquisável" ajuda="Relê as páginas tarjadas com OCR (mais lento)." />
      <${Alerta} nivel="info">As páginas tarjadas viram imagem: o que fica embaixo da tarja é apagado de verdade, não só coberto.<//>`;
  } else if (modo === 'recortar') {
    const r = extra.recorte || { x: 0, y: 0, w: 1, h: 1 };
    const mm = (v) => Math.round(v * 0.3528);
    painel = html`
      <div class="campo">
        <span class="rotulo">Aplicar em</span>
        <${Segmentado} valor=${extra.aplicarEm || 'todas'} aoMudar=${(v) => setExtra((x) => ({ ...x, aplicarEm: v }))} rotulo="Aplicar em"
          opcoes=${[{ valor: 'todas', rotulo: 'Todas as páginas' }, { valor: 'esta', rotulo: `Só na ${pagina}` }]} />
      </div>
      <div class="campo">
        <span class="rotulo">Cortando (milímetros)</span>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;color:var(--texto-2)">
          <span>Em cima: <b>${mm(r.y * tam.altura)}</b></span><span>Embaixo: <b>${mm((1 - r.y - r.h) * tam.altura)}</b></span>
          <span>Esquerda: <b>${mm(r.x * tam.largura)}</b></span><span>Direita: <b>${mm((1 - r.x - r.w) * tam.largura)}</b></span>
        </div>
      </div>
      <button class="btn btn-p" onClick=${() => setExtra((x) => ({ ...x, recorte: { x: 0.06, y: 0.06, w: 0.88, h: 0.88, pagina } }))}><${Icone} nome="recarregar" tam=${15} /> Recomeçar</button>
      <p class="ajuda" style="font-size:12px;color:var(--texto-3)">Arraste a moldura e as alças para escolher a área que fica.</p>`;
  }

  // propriedades do item selecionado
  let propriedades = null;
  if (selecionado && selecionado.tipo === 'texto') {
    const alterarTexto = (campos) => {
      const novo = ajustarTexto({ ...selecionado, ...campos });
      mudar(selecionado.id, { ...campos, w: novo.w, h: novo.h });
    };
    propriedades = html`<div class="campo" style="border-top:1px solid var(--linha);padding-top:14px">
      <span class="rotulo">Texto selecionado</span>
      <textarea rows="3" value=${selecionado.texto} onInput=${(e) => alterarTexto({ texto: e.currentTarget.value })}
        style="font-family:inherit;font-size:14px;min-height:70px"></textarea>
      <div class="campo-linha">
        <input type="number" min="5" max="120" value=${selecionado.tamanho} onInput=${(e) => alterarTexto({ tamanho: Number(e.currentTarget.value) || 12 })} aria-label="Tamanho" />
        <span class="unidade">pt</span>
        <input type="color" value=${selecionado.cor || '#111111'} onInput=${(e) => mudar(selecionado.id, { cor: e.currentTarget.value })} style="flex:0 0 40px;height:38px;padding:2px" aria-label="Cor" />
        <button class=${cx('btn', selecionado.negrito && 'btn-primario')} style="flex:0 0 42px;padding:0" onClick=${() => alterarTexto({ negrito: !selecionado.negrito })} aria-label="Negrito"><b>N</b></button>
      </div>
      <${Segmentado} valor=${selecionado.fonte || 'sans'} aoMudar=${(v) => alterarTexto({ fonte: v })} rotulo="Fonte"
        opcoes=${[{ valor: 'sans', rotulo: 'Arial' }, { valor: 'serif', rotulo: 'Times' }, { valor: 'mono', rotulo: 'Courier' }]} />
      <${Alternar} ligado=${Boolean(selecionado.todas)} aoMudar=${(v) => mudar(selecionado.id, { todas: v })} titulo="Repetir em todas as páginas" />
    </div>`;
  } else if (selecionado && (selecionado.tipo === 'imagem' || selecionado.tipo === 'retangulo' || selecionado.tipo === 'tarja')) {
    propriedades = html`<div class="campo" style="border-top:1px solid var(--linha);padding-top:14px">
      <span class="rotulo">${selecionado.variante === 'assinatura' ? 'Assinatura selecionada' : selecionado.tipo === 'tarja' ? 'Tarja selecionada' : 'Item selecionado'}</span>
      <${Alternar} ligado=${Boolean(selecionado.todas)} aoMudar=${(v) => mudar(selecionado.id, { todas: v })}
        titulo=${selecionado.variante === 'assinatura' ? 'Rubricar todas as páginas' : 'Repetir em todas as páginas'}
        ajuda="No mesmo lugar em cada página." />
      ${selecionado.tipo === 'retangulo' && selecionado.variante === 'caixa' && html`<div class="campo-linha">
        <span class="unidade">Cor da borda</span><input type="color" value=${selecionado.borda || '#d92d20'} onInput=${(e) => mudar(selecionado.id, { borda: e.currentTarget.value })} style="flex:0 0 44px;height:34px;padding:2px" />
      </div>`}
      <button class="btn btn-p btn-perigo" onClick=${() => apagar(selecionado.id)}><${Icone} nome="lixo" tam=${15} /> Apagar</button>
    </div>`;
  }

  return html`<div class="editor">
    ${miniaturas}
    <div style="display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0">
      ${navPaginas}
      ${palcoEl}
    </div>
    <aside class="painel" style="display:flex;flex-direction:column;min-height:0">
      <div class="painel-cab"><${Icone} nome=${f.icone === 'tarjar' ? 'tarjar' : 'editar'} tam=${17} /><h3>${f.titulo}</h3>
        <button class="btn btn-p btn-fantasma" style="margin-left:auto" onClick=${aoTrocar} title="Escolher outro PDF">Trocar PDF</button>
      </div>
      <div class="painel-corpo" style="flex:1">
        ${painel}
        ${propriedades}
      </div>
      <div class="painel-rodape">
        ${botao}
        ${problema && html`<span class="nota">${problema}</span>`}
      </div>
    </aside>
    ${dialogo && html`<${DialogoAssinatura} aoFechar=${() => setDialogo(false)}
      aoUsar=${(r) => { setDialogo(false); inserirImagem(r.dataUrl, r.largura, r.altura, { variante: 'assinatura' }); assinaturas.recarregar(); }} />`}
  </div>`;
}
