// Ponto único de importação do Preact + htm (JSX sem etapa de build).
export { html, render, h } from 'htm/preact';
export {
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer,
} from 'preact/hooks';

/** Junta classes condicionais: cx('a', cond && 'b') */
export function cx(...partes) {
  return partes.filter(Boolean).join(' ');
}

const nf = new Intl.NumberFormat('pt-BR');

export function numero(n) {
  return nf.format(n);
}

export function plural(n, um, varios) {
  return `${nf.format(n)} ${n === 1 ? um : varios}`;
}

export function tamanho(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1000) return `${bytes} B`;
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
  const casas = i === 0 ? 0 : v < 10 ? 1 : 0;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })} ${u[i]}`;
}

export function semExtensao(nome) {
  return String(nome || '').replace(/\.[^./\\]+$/, '');
}

export function extensao(nome) {
  const m = /\.([^./\\]+)$/.exec(String(nome || ''));
  return m ? m[1].toLowerCase() : '';
}

const CORES_EXT = {
  pdf: '#e5322d', doc: '#2b579a', docx: '#2b579a', rtf: '#2b579a', odt: '#2b579a', txt: '#64748b',
  xls: '#1d6f42', xlsx: '#1d6f42', csv: '#1d6f42', ods: '#1d6f42',
  ppt: '#c43e1c', pptx: '#c43e1c', odp: '#c43e1c',
  jpg: '#d69e00', jpeg: '#d69e00', png: '#0ea5e9', webp: '#8b5cf6', gif: '#ec4899', tif: '#14b8a6', tiff: '#14b8a6', bmp: '#f97316',
  zip: '#7c3aed', html: '#e34f26',
};

export function corDaExtensao(nome) {
  return CORES_EXT[extensao(nome)] || '#64748b';
}

export function dataRelativa(ms) {
  const d = new Date(ms);
  const agora = new Date();
  const dif = (agora - d) / 1000;
  if (dif < 60) return 'agora mesmo';
  if (dif < 3600) return `há ${Math.floor(dif / 60)} min`;
  const mesmoDia = d.toDateString() === agora.toDateString();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (mesmoDia) return `hoje às ${hora}`;
  const ontem = new Date(agora); ontem.setDate(agora.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `ontem às ${hora}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ` às ${hora}`;
}

/** Guarda preferências pequenas do navegador sem quebrar quando o armazenamento está bloqueado. */
export const preferencias = {
  ler(chave, padrao) {
    try {
      const v = localStorage.getItem(`meupdf-${chave}`);
      return v == null ? padrao : JSON.parse(v);
    } catch (_) { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(`meupdf-${chave}`, JSON.stringify(valor)); } catch (_) { /* sem armazenamento */ }
  },
};
