'use strict';

/**
 * Intervalos de páginas digitados pela pessoa: "1-3, 7, 10-12".
 * Também aceita "5-" (da 5 até o fim) e "-3" (do começo até a 3).
 */

const { ErroUsuario } = require('./util');

/** Lê um trecho e devolve [inicio, fim] ou null. */
function lerTrecho(t, total) {
  const faixa = t.match(/^(\d*)\s*-\s*(\d*)$/);
  if (faixa && (faixa[1] || faixa[2])) {
    const a = faixa[1] ? Number(faixa[1]) : 1;
    const b = faixa[2] ? Number(faixa[2]) : total;
    return [a, b];
  }
  if (/^\d+$/.test(t)) return [Number(t), Number(t)];
  return null;
}

/** Texto -> lista de grupos, cada grupo uma lista ordenada de páginas (1-based). */
function grupos(texto, total) {
  const saida = [];
  for (const parte of String(texto || '').split(/[,;]/)) {
    const t = parte.trim();
    if (!t) continue;
    const trecho = lerTrecho(t, total);
    if (!trecho) throw new ErroUsuario(`Não entendi "${t}". Use algo como 1-3, 7, 10-12.`);
    let [a, b] = trecho;
    const paginas = [];
    const passo = a <= b ? 1 : -1;
    for (let i = a; passo > 0 ? i <= b : i >= b; i += passo) {
      if (i >= 1 && i <= total) paginas.push(i);
    }
    if (paginas.length) saida.push(paginas);
  }
  return saida;
}

/** Texto -> conjunto de páginas (1-based). Vazio quando o texto é vazio. */
function conjunto(texto, total) {
  const set = new Set();
  for (const g of grupos(texto, total)) for (const p of g) set.add(p);
  return set;
}

/**
 * Lista de páginas escolhidas: aceita array de números ou texto.
 * Vazio = todas as páginas.
 */
function escolhidas(valor, total) {
  let lista;
  if (Array.isArray(valor)) {
    lista = valor.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= total);
  } else if (valor && String(valor).trim()) {
    lista = Array.from(conjunto(valor, total));
  } else {
    lista = Array.from({ length: total }, (_, i) => i + 1);
  }
  return Array.from(new Set(lista)).sort((a, b) => a - b);
}

/** Conjunto/array de páginas -> texto compacto "1-3,7". */
function paraTexto(paginas) {
  const nums = Array.from(new Set(Array.from(paginas).map(Number))).filter((n) => n >= 1).sort((a, b) => a - b);
  if (!nums.length) return '';
  const trechos = [];
  let inicio = nums[0];
  let anterior = nums[0];
  for (let i = 1; i <= nums.length; i += 1) {
    const atual = nums[i];
    if (atual === anterior + 1) { anterior = atual; continue; }
    trechos.push(inicio === anterior ? String(inicio) : `${inicio}-${anterior}`);
    inicio = atual;
    anterior = atual;
  }
  return trechos.join(',');
}

module.exports = { grupos, conjunto, escolhidas, paraTexto };
