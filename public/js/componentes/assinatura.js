import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar } from '../loja.js';
import { Dialogo } from './base.js';
import { Segmentado, Alternar } from './opcoes.js';

/* ============================================================
   Criar assinatura: desenhar, digitar ou foto do papel
   ============================================================ */

const CORES_CANETA = [
  { valor: '#111827', rotulo: 'Preta' },
  { valor: '#1d3fae', rotulo: 'Azul' },
];

// Fontes de letra cursiva que costumam existir no Windows (e alternativas).
const FONTES_CURSIVAS = [
  '"Segoe Script", cursive',
  '"Lucida Handwriting", cursive',
  '"Brush Script MT", "Brush Script Std", cursive',
  '"Ink Free", cursive',
  'Gabriola, cursive',
];

/** Corta as bordas transparentes e devolve PNG em base64. */
export function recortarTransparente(canvas, folga = 6) {
  const ctx = canvas.getContext('2d');
  const { width: l, height: a } = canvas;
  const dados = ctx.getImageData(0, 0, l, a).data;
  let x0 = l; let y0 = a; let x1 = -1; let y1 = -1;
  for (let y = 0; y < a; y += 1) {
    for (let x = 0; x < l; x += 1) {
      if (dados[(y * l + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - folga); y0 = Math.max(0, y0 - folga);
  x1 = Math.min(l - 1, x1 + folga); y1 = Math.min(a - 1, y1 + folga);
  const saida = document.createElement('canvas');
  saida.width = x1 - x0 + 1;
  saida.height = y1 - y0 + 1;
  saida.getContext('2d').drawImage(canvas, x0, y0, saida.width, saida.height, 0, 0, saida.width, saida.height);
  return { dataUrl: saida.toDataURL('image/png'), largura: saida.width, altura: saida.height };
}

/* ---------------- desenhar ---------------- */

function QuadroDesenho({ cor, espessura, aoMudar }) {
  const canvas = useRef(null);
  const tracos = useRef([]);
  const [vazio, setVazio] = useState(true);

  const redesenhar = () => {
    const c = canvas.current;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = cor;
    for (const t of tracos.current) {
      if (!t.length) continue;
      ctx.beginPath();
      ctx.moveTo(t[0].x, t[0].y);
      for (let i = 1; i < t.length - 1; i += 1) {
        // curva suave entre os pontos (fica mais parecido com caneta)
        const mx = (t[i].x + t[i + 1].x) / 2;
        const my = (t[i].y + t[i + 1].y) / 2;
        ctx.lineWidth = t[i].w;
        ctx.quadraticCurveTo(t[i].x, t[i].y, mx, my);
      }
      const u = t[t.length - 1];
      ctx.lineTo(u.x + 0.01, u.y);
      ctx.stroke();
    }
  };

  useEffect(() => {
    const c = canvas.current;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(r.width * dpr * 1.5);
    c.height = Math.round(r.height * dpr * 1.5);
    redesenhar();
  }, []);
  useEffect(() => { redesenhar(); }, [cor]);

  const ponto = (e) => {
    const c = canvas.current;
    const r = c.getBoundingClientRect();
    const pressao = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5;
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
      w: espessura * (c.width / r.width) * (0.6 + pressao * 0.8),
    };
  };

  const desenhando = useRef(false);
  const inicio = (e) => {
    e.preventDefault();
    try { canvas.current.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro sintético */ }
    desenhando.current = true;
    tracos.current.push([ponto(e)]);
    setVazio(false);
  };
  const mover = (e) => {
    if (!desenhando.current) return;
    const juntos = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const pts = juntos.length ? juntos : [e];
    const t = tracos.current[tracos.current.length - 1];
    for (const p of pts) t.push(ponto(p));
    redesenhar();
  };
  const fim = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    aoMudar(canvas.current);
  };

  const limpar = () => { tracos.current = []; setVazio(true); redesenhar(); aoMudar(null); };
  const desfazer = () => { tracos.current.pop(); setVazio(!tracos.current.length); redesenhar(); aoMudar(tracos.current.length ? canvas.current : null); };

  return html`<div>
    <div class="quadro-assinatura">
      <canvas ref=${canvas} onPointerDown=${inicio} onPointerMove=${mover} onPointerUp=${fim} onPointerCancel=${fim}></canvas>
      <div class="linha-base"></div>
      ${vazio && html`<div class="dica">Assine aqui com o mouse, o dedo ou a caneta</div>`}
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-p" onClick=${desfazer} disabled=${vazio}><${Icone} nome="girarEsquerda" tam=${15} /> Desfazer</button>
      <button class="btn btn-p" onClick=${limpar} disabled=${vazio}><${Icone} nome="borracha" tam=${15} /> Limpar</button>
    </div>
  </div>`;
}

/* ---------------- digitar ---------------- */

function Digitar({ cor, aoMudar }) {
  const [nome, setNome] = useState('');
  const [fonte, setFonte] = useState(0);

  useEffect(() => {
    if (!nome.trim()) { aoMudar(null); return; }
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 360;
    const ctx = c.getContext('2d');
    ctx.fillStyle = cor;
    ctx.textBaseline = 'middle';
    let tam = 150;
    ctx.font = `${tam}px ${FONTES_CURSIVAS[fonte]}`;
    while (ctx.measureText(nome).width > c.width - 80 && tam > 40) { tam -= 8; ctx.font = `${tam}px ${FONTES_CURSIVAS[fonte]}`; }
    ctx.fillText(nome, 40, c.height / 2);
    aoMudar(c);
  }, [nome, fonte, cor]);

  return html`<div style="display:flex;flex-direction:column;gap:10px">
    <input class="entrada" type="text" placeholder="Seu nome" value=${nome} onInput=${(e) => setNome(e.currentTarget.value)} maxlength="60" />
    <div style="display:grid;gap:6px">
      ${FONTES_CURSIVAS.map((f, i) => html`<button key=${i} type="button" class=${cx('escolha', fonte === i && 'ativo')} onClick=${() => setFonte(i)}
        style=${`font-family:${f};font-size:26px;color:${cor};padding:6px 14px;background:#fff`}>
        ${nome || 'Sua assinatura'}
      </button>`)}
    </div>
  </div>`;
}

/* ---------------- foto do papel ---------------- */

function Foto({ cor, aoMudar }) {
  const entrada = useRef(null);
  const [previa, setPrevia] = useState(null);
  const [limiar, setLimiar] = useState(165);
  const [imagem, setImagem] = useState(null);

  useEffect(() => {
    if (!imagem) return;
    const max = 1600;
    const escala = Math.min(1, max / Math.max(imagem.width, imagem.height));
    const c = document.createElement('canvas');
    c.width = Math.round(imagem.width * escala);
    c.height = Math.round(imagem.height * escala);
    const ctx = c.getContext('2d');
    ctx.drawImage(imagem, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const [r0, g0, b0] = [parseInt(cor.slice(1, 3), 16), parseInt(cor.slice(3, 5), 16), parseInt(cor.slice(5, 7), 16)];
    for (let i = 0; i < d.data.length; i += 4) {
      const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      if (lum > limiar) d.data[i + 3] = 0; // papel some
      else {
        // traço vira a cor escolhida, com borda suave
        const forca = Math.min(1, (limiar - lum) / 60);
        d.data[i] = r0; d.data[i + 1] = g0; d.data[i + 2] = b0;
        d.data[i + 3] = Math.round(255 * forca);
      }
    }
    ctx.putImageData(d, 0, 0);
    setPrevia(c.toDataURL('image/png'));
    aoMudar(c);
  }, [imagem, limiar, cor]);

  const escolher = (arquivo) => {
    if (!arquivo) return;
    const img = new Image();
    img.onload = () => setImagem(img);
    img.src = URL.createObjectURL(arquivo);
  };

  return html`<div style="display:flex;flex-direction:column;gap:10px">
    <input ref=${entrada} type="file" accept="image/*" hidden onChange=${(e) => escolher(e.currentTarget.files[0])} />
    <p style="color:var(--texto-2);font-size:13px">Assine num papel branco, tire uma foto bem iluminada e escolha aqui. O fundo branco some sozinho.</p>
    <button class="btn" onClick=${() => entrada.current.click()}><${Icone} nome="imagem" tam=${16} /> ${imagem ? 'Trocar foto' : 'Escolher foto ou imagem'}</button>
    ${previa && html`<div class="quadro-assinatura" style="display:grid;place-items:center;padding:10px;min-height:120px">
      <img src=${previa} alt="Prévia da assinatura" style="max-height:150px;max-width:100%" />
    </div>
    <div class="campo"><span class="rotulo">Limpeza do fundo</span>
      <div class="faixa"><input type="range" min="90" max="235" value=${limiar} onInput=${(e) => setLimiar(Number(e.currentTarget.value))} /><output>${limiar}</output></div>
      <span class="ajuda">Se sobrar sujeira do papel, diminua. Se a assinatura falhar, aumente.</span>
    </div>`}
  </div>`;
}

/* ---------------- diálogo ---------------- */

export function DialogoAssinatura({ aoFechar, aoUsar }) {
  const [modo, setModo] = useState('desenhar');
  const [cor, setCor] = useState('#111827');
  const [espessura, setEspessura] = useState(3);
  const [guardar, setGuardar] = useState(true);
  const fonte = useRef(null);
  const [pronta, setPronta] = useState(false);

  const mudou = (canvas) => { fonte.current = canvas; setPronta(Boolean(canvas)); };

  const usar = async () => {
    if (!fonte.current) return;
    const r = recortarTransparente(fonte.current);
    if (!r) { avisar('A assinatura está vazia.', 'aviso'); return; }
    if (guardar) api.post('/assinaturas', { imagem: r.dataUrl }).catch(() => {});
    aoUsar(r);
  };

  return html`<${Dialogo} titulo="Criar assinatura" aoFechar=${aoFechar} classe="largo"
    rodape=${html`
      <span class="rodape-guardar"><${Alternar} ligado=${guardar} aoMudar=${setGuardar} titulo="Guardar para usar de novo" /></span>
      <button class="btn" onClick=${aoFechar}>Cancelar</button>
      <button class="btn btn-primario" onClick=${usar} disabled=${!pronta}><${Icone} nome="check" tam=${16} /> Usar assinatura</button>`}>
    <div class="dialogo-corpo">
      <${Segmentado} valor=${modo} aoMudar=${(m) => { setModo(m); mudou(null); }} rotulo="Como criar"
        opcoes=${[{ valor: 'desenhar', rotulo: 'Desenhar' }, { valor: 'digitar', rotulo: 'Digitar' }, { valor: 'foto', rotulo: 'Foto do papel' }]} />
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <span class="rotulo" style="font-size:13px;font-weight:600">Cor da tinta</span>
        <div class="cores">${CORES_CANETA.map((c) => html`<button key=${c.valor} class=${cx(cor === c.valor && 'ativo')} style=${`background:${c.valor}`} title=${c.rotulo} aria-label=${`Tinta ${c.rotulo}`} onClick=${() => setCor(c.valor)}></button>`)}</div>
        ${modo === 'desenhar' && html`<span class="rotulo" style="font-size:13px;font-weight:600;margin-left:10px">Espessura</span>
          <${Segmentado} valor=${espessura} aoMudar=${setEspessura} rotulo="Espessura"
            opcoes=${[{ valor: 2, rotulo: 'Fina' }, { valor: 3, rotulo: 'Média' }, { valor: 5, rotulo: 'Grossa' }]} />`}
      </div>
      ${modo === 'desenhar' && html`<${QuadroDesenho} cor=${cor} espessura=${espessura} aoMudar=${mudou} />`}
      ${modo === 'digitar' && html`<${Digitar} cor=${cor} aoMudar=${mudou} />`}
      ${modo === 'foto' && html`<${Foto} cor=${cor} aoMudar=${mudou} />`}
    </div>
  <//>`;
}

/* ---------------- assinaturas guardadas ---------------- */

export function useAssinaturas() {
  const [lista, setLista] = useState([]);
  const carregar = () => api.get('/assinaturas').then((d) => setLista(d.assinaturas)).catch(() => {});
  useEffect(() => { carregar(); }, []);
  return { lista, recarregar: carregar };
}

/** Busca a imagem guardada e devolve como dataURL (+ tamanho). */
export async function carregarAssinatura(id) {
  const r = await fetch(`/api/assinaturas/${id}`);
  const blob = await r.blob();
  const dataUrl = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(blob); });
  const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = falha; i.src = dataUrl; });
  return { dataUrl, largura: img.width, altura: img.height };
}
