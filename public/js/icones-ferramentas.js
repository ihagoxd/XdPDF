import { html } from './lib.js';

/* ============================================================
   Ícones das ferramentas — desenhados para o MeuPDF.
   Chapados, em dois tons da cor da ferramenta (currentColor):
   folha clara, dobra média e o símbolo cheio.
   Grade de 48x48.
   ============================================================ */

const CLARO = 'class="c"';
const MEDIO = 'class="m"';
const CLARO2 = 'class="c2"';

/** Folha com a dobra no canto. */
const folha = (o = CLARO) => `<path ${o} d="M12.5 4H28l10 10v25.5a4.5 4.5 0 0 1-4.5 4.5h-21A4.5 4.5 0 0 1 8 39.5v-31A4.5 4.5 0 0 1 12.5 4z"/>`
  + `<path ${MEDIO} d="M28 4v6.5a3.5 3.5 0 0 0 3.5 3.5H38z"/>`;

/** Folha pequena em qualquer lugar. */
const folhinha = (x, y, l, a, o) => {
  const d = Math.min(l, a) * 0.32;
  return `<path ${o} d="M${x + 2.5} ${y}h${l - d - 2.5}l${d} ${d}v${a - d - 2.5}a2.5 2.5 0 0 1-2.5 2.5h${-(l - 5)}a2.5 2.5 0 0 1-2.5-2.5v${-(a - 5)}a2.5 2.5 0 0 1 2.5-2.5z"/>`;
};

/** Linhas de texto. */
const linhas = (ys, x = 14, larguras = [], o = MEDIO) => ys
  .map((y, i) => `<rect ${o} x="${x}" y="${y}" width="${larguras[i] || 16}" height="3" rx="1.5"/>`).join('');

/** Selo com a letra do formato (canto inferior esquerdo). */
const selo = (letra) => `<rect x="3" y="21" width="24" height="22" rx="5"/>${letra}`;
const BRANCO = 'fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"';

const LETRAS = {
  W: `<path ${BRANCO} d="M8.5 26.5l2.6 11 3.9-8.4 3.9 8.4 2.6-11"/>`,
  X: `<path ${BRANCO} d="M9.5 26.5l11 11m0-11-11 11"/>`,
  P: `<path ${BRANCO} d="M11 38V26.5h4.6a3.9 3.9 0 0 1 0 7.8H11"/>`,
  T: `<path ${BRANCO} d="M9 27h12M15 27v11"/>`,
  A: `<path ${BRANCO} d="M9.5 38 15 26l5.5 12M11.4 34h7.2"/>`,
  codigo: `<path ${BRANCO} d="M11.5 27.5 7.8 32l3.7 4.5m7-9 3.7 4.5-3.7 4.5"/>`,
  foto: '<circle cx="19.5" cy="27.5" r="2.4" fill="#fff"/><path fill="#fff" d="M7 38.5l5.2-7.2 3.6 4.4 2.4-2.6 4.8 5.4z"/>',
};

/** Seta pequena indicando "sai do PDF para outro formato". */
const saida = '<circle cx="36" cy="36" r="8"/><path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M32.6 36h6.6m-2.8-3 3 3-3 3"/>';

const traco = (d, larg = 3.4, o = '') => `<path ${o} fill="none" stroke="currentColor" stroke-width="${larg}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;

const DESENHOS = {
  juntar:
    folhinha(4, 4, 15, 18, MEDIO) + folhinha(29, 4, 15, 18, MEDIO)
    + traco('M12 25.5 18 31M36 25.5 30 31', 3)
    + folhinha(14, 27, 20, 17, ''),
  dividir:
    folhinha(14, 4, 20, 17, '')
    + traco('M18 24.5 12 30M30 24.5 36 30', 3)
    + folhinha(4, 27, 15, 17, MEDIO) + folhinha(29, 27, 15, 17, MEDIO),
  remover:
    folha() + linhas([12, 18], 13, [12, 18])
    + '<circle cx="31" cy="33" r="10"/><rect x="25" y="31.5" width="12" height="3" rx="1.5" fill="#fff"/>',
  extrair:
    folha() + linhas([12, 18, 24], 13, [11, 18, 9])
    + traco('M20 38 38 20') + traco('M27 18.5h12.5V31'),
  organizar:
    folhinha(5, 4, 16, 19, '') + folhinha(27, 4, 16, 19, CLARO2)
    + folhinha(5, 25, 16, 19, CLARO2) + folhinha(27, 25, 16, 19, MEDIO),
  girar:
    folha()
    + traco('M31.5 23.5a9 9 0 1 0 1.4 9.2', 3.6) + '<path d="M35.6 17.2l-.6 9.4-8.9-3z"/>',
  comprimir:
    `<rect ${CLARO} x="7" y="18" width="34" height="12" rx="3.5"/><rect ${MEDIO} x="12" y="22.5" width="17" height="3" rx="1.5"/>`
    + '<path d="M21 3h6v6.5h5L24 16.8 16 9.5h5z"/><path d="M21 45h6v-6.5h5L24 31.2 16 38.5h5z"/>',
  ocr:
    traco('M5 14V8.5A3.5 3.5 0 0 1 8.5 5H14M34 5h5.5A3.5 3.5 0 0 1 43 8.5V14M43 34v5.5a3.5 3.5 0 0 1-3.5 3.5H34M14 43H8.5A3.5 3.5 0 0 1 5 39.5V34', 3.4)
    + linhas([14, 20, 32], 13, [20, 15, 18], MEDIO)
    + '<rect x="3" y="24.5" width="42" height="3.6" rx="1.8"/>',
  reparar:
    folha()
    + '<g transform="rotate(-40 23.5 27)"><rect x="9.5" y="21" width="28" height="12" rx="6"/>'
    + '<rect x="19" y="21" width="9" height="12" fill="#fff" opacity=".5"/>'
    + '<circle cx="21.6" cy="24.6" r="1" fill="currentColor"/><circle cx="25.4" cy="24.6" r="1" fill="currentColor"/>'
    + '<circle cx="21.6" cy="29.4" r="1" fill="currentColor"/><circle cx="25.4" cy="29.4" r="1" fill="currentColor"/></g>',
  'imagem-pdf':
    folha() + '<circle cx="29" cy="20" r="4"/><path d="M8 38.5 18.5 25l6.8 8.2 4.4-4.6 8.3 9.9V39.5a4.5 4.5 0 0 1-4.5 4.5h-21A4.5 4.5 0 0 1 8 39.5z"/>',
  'word-pdf': folha() + linhas([20, 26, 32], 30, [5, 5, 5]) + selo(LETRAS.W),
  'excel-pdf': folha() + linhas([20, 26, 32], 30, [5, 5, 5]) + selo(LETRAS.X),
  'powerpoint-pdf': folha() + linhas([20, 26, 32], 30, [5, 5, 5]) + selo(LETRAS.P),
  'html-pdf': folha() + linhas([20, 26, 32], 30, [5, 5, 5]) + selo(LETRAS.codigo),
  'pdf-jpg': folha() + selo(LETRAS.foto) + saida,
  'pdf-word': folha() + selo(LETRAS.W) + saida,
  'pdf-excel': folha() + selo(LETRAS.X) + saida,
  'pdf-powerpoint': folha() + selo(LETRAS.P) + saida,
  'pdf-texto': folha() + selo(LETRAS.T) + saida,
  'pdf-pdfa': folha() + selo(LETRAS.A) + saida,
  editar:
    folha() + linhas([12, 18, 24], 13, [11, 18, 12])
    + '<g transform="rotate(45 30.5 31.5)"><rect x="26.5" y="16" width="8" height="21" rx="1.6"/>'
    + '<rect x="26.5" y="19.5" width="8" height="2.6" fill="#fff" opacity=".55"/><path d="M26.5 37h8L30.5 44z"/></g>',
  assinar:
    folha()
    + traco('M12 31.5c2.6-4.6 4.6-10.5 6.6-10.5 2.6 0-.4 10.6 1.9 10.6 2 0 3-5.3 5-5.3 1.8 0 1 4 3 4 1.7 0 3.1-1.7 4.3-3', 3.2)
    + `<rect ${MEDIO} x="12" y="36" width="22" height="3" rx="1.5"/>`
    + traco('M12.5 12.5l4 4m0-4-4 4', 2.6),
  numerar:
    folha() + linhas([11, 17, 23], 13, [12, 18, 15])
    + '<rect x="15" y="30.5" width="16" height="10" rx="5"/>'
    + '<path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M22 33.6l1.8-1.1v6.2"/>',
  'marca-dagua':
    folha() + linhas([11], 13, [12])
    + '<g transform="rotate(-38 23 27)"><rect x="3" y="22" width="40" height="10" rx="2"/>'
    + '<rect x="9" y="25.6" width="5" height="2.8" rx="1.4" fill="#fff"/><rect x="16" y="25.6" width="9" height="2.8" rx="1.4" fill="#fff"/><rect x="27" y="25.6" width="6" height="2.8" rx="1.4" fill="#fff"/></g>',
  recortar:
    `<rect ${CLARO} x="14" y="14" width="20" height="20" rx="2"/>`
    + traco('M14 4v26a4 4 0 0 0 4 4h26M4 14h26a4 4 0 0 1 4 4v26', 3.6),
  metadados:
    folha() + linhas([12, 18], 13, [12, 17])
    + '<path d="M17 26.5h12.4a3 3 0 0 1 2.2 1l6.3 6.8-6.3 6.8a3 3 0 0 1-2.2 1H17a3 3 0 0 1-3-3v-9.6a3 3 0 0 1 3-3z"/><circle cx="29.5" cy="34.3" r="2.3" fill="#fff"/>',
  achatar:
    '<path class="c2" d="M24 29 44 37.5 24 46 4 37.5z"/><path class="m" d="M24 18 44 26.5 24 35 4 26.5z"/><path d="M24 4 44 12.5 24 21 4 12.5z"/>',
  proteger:
    folha() + traco('M17.5 27v-4.5a6.5 6.5 0 0 1 13 0V27', 3.4)
    + '<rect x="13" y="26" width="22" height="16" rx="3.5"/><circle cx="24" cy="32.6" r="2.4" fill="#fff"/><rect x="22.9" y="33" width="2.2" height="5" rx="1.1" fill="#fff"/>',
  desbloquear:
    folha() + traco('M17.5 27v-4.5a6.5 6.5 0 0 1 12.6-2.3', 3.4)
    + '<rect x="13" y="26" width="22" height="16" rx="3.5"/><circle cx="24" cy="32.6" r="2.4" fill="#fff"/><rect x="22.9" y="33" width="2.2" height="5" rx="1.1" fill="#fff"/>',
  tarjar:
    folha() + `<rect ${MEDIO} x="13" y="12" width="12" height="3" rx="1.5"/>`
    + '<rect x="13" y="18.5" width="21" height="5.5" rx="1.2"/>'
    + `<rect ${MEDIO} x="13" y="27.5" width="8" height="3" rx="1.5"/><rect x="23" y="26.2" width="11" height="5.5" rx="1.2"/>`
    + `<rect ${MEDIO} x="13" y="34.5" width="17" height="3" rx="1.5"/>`,
  comparar:
    folhinha(3, 6, 19, 36, CLARO) + folhinha(26, 6, 19, 36, CLARO)
    + linhas([14, 20, 32], 7, [10, 11, 8]) + linhas([14, 32], 30, [10, 8])
    + '<rect x="7" y="25.2" width="11" height="3.6" rx="1.8"/><rect x="30" y="20" width="11" height="3.6" rx="1.8"/><rect x="30" y="25.2" width="7" height="3.6" rx="1.8"/>',
};

export function IconeFerramenta({ id, cor, tam = 40, classe = '' }) {
  const corpo = DESENHOS[id] || folha();
  return html`<svg class=${`ic-ferr ${classe}`} width=${tam} height=${tam} viewBox="0 0 48 48" fill="currentColor"
    style=${cor ? `--cor:${cor}` : ''} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: corpo }}></svg>`;
}
