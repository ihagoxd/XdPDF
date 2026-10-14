import { html, render, useEffect, useRef, useState } from '../lib.js';
import { Icone } from '../icones.js';
import { abrirDoc, desenharEm } from '../pdfvisual.js';
import { Dialogo } from './base.js';

/** Uma página desenhada quando entra na tela. */
function PaginaGrande({ url, pagina, largura, proporcao }) {
  const canvas = useRef(null);
  const caixa = useRef(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisivel(true); }, { rootMargin: '600px 0px' });
    if (caixa.current) obs.observe(caixa.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (visivel && canvas.current) desenharEm(canvas.current, url, pagina, largura).catch(() => {});
  }, [visivel, largura]);

  return html`<div ref=${caixa} style=${`width:${largura}px;min-height:${Math.round(largura * proporcao)}px`}>
    <canvas class="folha-grande" ref=${canvas} style=${`width:${largura}px;height:${Math.round(largura * proporcao)}px`}></canvas>
  </div>`;
}

function Visualizador({ titulo, url, aoFechar, acoes }) {
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    abrirDoc(url).then(async (doc) => {
      const proporcoes = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
        proporcoes.push(vp.height / vp.width);
      }
      setInfo({ paginas: doc.numPages, proporcoes });
    }).catch(() => setErro('Não foi possível abrir este PDF.'));
  }, [url]);

  const largura = Math.round(Math.min(860, window.innerWidth - 120) * zoom);

  return html`<${Dialogo} titulo=${titulo} aoFechar=${aoFechar} classe="tela-cheia"
    rodape=${html`
      <div class="zoom-controle">
        <button class="btn-icone p" onClick=${() => setZoom((z) => Math.max(0.4, z - 0.15))} aria-label="Diminuir"><${Icone} nome="zoomMenos" tam=${16} /></button>
        <span>${Math.round(zoom * 100)}%</span>
        <button class="btn-icone p" onClick=${() => setZoom((z) => Math.min(3, z + 0.15))} aria-label="Ampliar"><${Icone} nome="zoomMais" tam=${16} /></button>
      </div>
      <span style="margin-right:auto;color:var(--texto-3);font-size:13px;align-self:center">${info ? `${info.paginas} página${info.paginas === 1 ? '' : 's'}` : ''}</span>
      ${acoes}
      <button class="btn" onClick=${aoFechar}>Fechar</button>`}>
    <div class="dialogo-corpo visualizador-corpo">
      ${erro && html`<div class="alerta erro">${erro}</div>`}
      ${!info && !erro && html`<div class="anel"></div>`}
      ${info && info.proporcoes.map((p, i) => html`<${PaginaGrande} key=${`${i}-${largura}`} url=${url} pagina=${i + 1} largura=${largura} proporcao=${p} />
        <div class="rotulo-pagina">${i + 1} de ${info.paginas}</div>`)}
    </div>
  <//>`;
}

/** Abre o visualizador por cima de tudo. */
export function abrirVisualizador({ titulo, url, acoes }) {
  const raiz = document.createElement('div');
  document.body.appendChild(raiz);
  const fechar = () => { render(null, raiz); raiz.remove(); };
  render(html`<${Visualizador} titulo=${titulo} url=${url} aoFechar=${fechar} acoes=${acoes} />`, raiz);
}
