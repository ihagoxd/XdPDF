/* ============================================================
   pdf.js no navegador: miniaturas e páginas grandes
   ============================================================ */
import * as pdfjs from '/vendor/pdfjs/pdf.min.mjs';
import { html, useEffect, useRef, useState } from './lib.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const docs = new Map();

/** Abre (uma vez) o PDF de uma URL. */
export function abrirDoc(url) {
  if (!docs.has(url)) {
    const tarefa = pdfjs.getDocument({
      url,
      cMapUrl: '/vendor/pdfjs-cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs-fontes/',
      isEvalSupported: false,
      enableXfa: false,
    });
    const p = tarefa.promise;
    p.catch(() => docs.delete(url));
    docs.set(url, p);
  }
  return docs.get(url);
}

export function esquecerDoc(url) {
  const p = docs.get(url);
  docs.delete(url);
  if (p) p.then((d) => d.destroy()).catch(() => {});
  for (const chave of Array.from(cache.keys())) {
    if (chave.startsWith(`${url}|`)) {
      cache.get(chave).then((m) => m && URL.revokeObjectURL(m.src)).catch(() => {});
      cache.delete(chave);
    }
  }
}

/* ---------------- fila de desenho ---------------- */

const cache = new Map();
const fila = [];
let ativos = 0;
const SIMULTANEOS = 3;

function proximo() {
  while (ativos < SIMULTANEOS && fila.length) {
    const job = fila.shift();
    ativos += 1;
    job().finally(() => { ativos -= 1; proximo(); });
  }
}

function enfileirar(fn, prioridade = false) {
  return new Promise((resolve, reject) => {
    const job = () => fn().then(resolve, reject);
    if (prioridade) fila.unshift(job); else fila.push(job);
    proximo();
  });
}

/**
 * Desenha uma página numa imagem.
 * @returns {Promise<{src:string, largura:number, altura:number}>} largura/altura em pontos (já girada)
 */
export function miniatura(url, pagina, larguraPx = 220) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const alvo = Math.round(larguraPx * dpr);
  const chave = `${url}|${pagina}|${alvo}`;
  if (!cache.has(chave)) {
    const p = enfileirar(async () => {
      const doc = await abrirDoc(url);
      const pg = await doc.getPage(pagina);
      const base = pg.getViewport({ scale: 1 });
      const escala = alvo / base.width;
      const vp = pg.getViewport({ scale: escala });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      canvas.width = 0; canvas.height = 0;
      return { src: URL.createObjectURL(blob), largura: base.width, altura: base.height };
    });
    p.catch(() => cache.delete(chave));
    cache.set(chave, p);
  }
  return cache.get(chave);
}

/** Tamanho (em pontos, já girado) de cada página — rápido, sem desenhar. */
export async function tamanhos(url) {
  const doc = await abrirDoc(url);
  const lista = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    lista.push({ largura: vp.width, altura: vp.height });
  }
  return lista;
}

const geracoes = new WeakMap();

/**
 * Desenha uma página grande num canvas da tela.
 * Cada pedido desenha num canvas próprio fora da tela e só copia no fim: se
 * o tamanho mudar no meio (ao medir a tela, ao dar zoom), o desenho antigo é
 * descartado em vez de brigar pelo mesmo canvas.
 */
export async function desenharEm(canvas, url, pagina, larguraCss) {
  const minha = (geracoes.get(canvas) || 0) + 1;
  geracoes.set(canvas, minha);
  const doc = await abrirDoc(url);
  const pg = await doc.getPage(pagina);
  const base = pg.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pg.getViewport({ scale: (larguraCss / base.width) * dpr });
  const fora = document.createElement('canvas');
  fora.width = Math.round(vp.width);
  fora.height = Math.round(vp.height);
  const ctxFora = fora.getContext('2d');
  ctxFora.fillStyle = '#fff';
  ctxFora.fillRect(0, 0, fora.width, fora.height);
  await pg.render({ canvasContext: ctxFora, viewport: vp }).promise;
  if (geracoes.get(canvas) !== minha) return null; // já pediram outro desenho
  canvas.width = fora.width;
  canvas.height = fora.height;
  canvas.style.width = `${larguraCss}px`;
  canvas.style.height = `${(larguraCss * base.height) / base.width}px`;
  canvas.getContext('2d').drawImage(fora, 0, 0);
  fora.width = 0;
  fora.height = 0;
  return { largura: base.width, altura: base.height };
}

/* ---------------- componente: miniatura preguiçosa ---------------- */

const observador = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting && e.target.__visivel) {
        observador.unobserve(e.target);
        e.target.__visivel();
      }
    }
  }, { rootMargin: '400px 0px' })
  : null;

/** Mostra a página só quando ela chega perto da tela. */
export function Miniatura({ url, pagina = 1, largura = 220, classe = 'miniatura', alt = '' }) {
  const ref = useRef(null);
  const [img, setImg] = useState(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    setImg(null);
    setFalhou(false);
    if (!url) return undefined;
    const carregar = () => miniatura(url, pagina, largura)
      .then((m) => { if (vivo) setImg(m); })
      .catch(() => { if (vivo) setFalhou(true); });
    const el = ref.current;
    if (observador && el) {
      el.__visivel = carregar;
      observador.observe(el);
    } else {
      carregar();
    }
    return () => { vivo = false; if (observador && el) observador.unobserve(el); };
  }, [url, pagina, largura]);

  if (falhou) return html`<div class="miniatura-vazia" ref=${ref}>Sem prévia</div>`;
  if (!img) return html`<div class="carregando-folha" ref=${ref}></div>`;
  return html`<img ref=${ref} class=${classe} src=${img.src} alt=${alt} draggable="false" />`;
}
