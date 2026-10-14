import { html, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { CartaoArquivo } from './area-arquivos.js';

/** Escolha das duas versões. */
export function AreaComparar({ arquivos, aoRemover, aoAdicionar, aoSenha }) {
  const [a, b] = arquivos;
  const vaga = (rotulo, arquivo, n) => html`<div style="display:flex;flex-direction:column;gap:8px">
    <span class="rotulo" style="font-weight:650;font-size:13px">${n}. ${rotulo}</span>
    ${arquivo
      ? html`<${CartaoArquivo} a=${arquivo} aoRemover=${aoRemover} aoSenha=${aoSenha} />`
      : html`<button class="adicionar-cartao" onClick=${aoAdicionar}><${Icone} nome="mais" tam=${24} />Escolher a ${rotulo.toLowerCase()}</button>`}
  </div>`;
  return html`<div>
    <p style="color:var(--texto-2);font-size:13px;margin-bottom:14px">
      O primeiro arquivo é a versão anterior; o segundo, a nova. O XdPDF compara o texto linha por linha e mostra, palavra por palavra, o que mudou.
    </p>
    <div class="grade-arquivos" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      ${vaga('Versão anterior', a, 1)}
      ${vaga('Versão nova', b, 2)}
    </div>
  </div>`;
}

function Partes({ partes, lado }) {
  return partes.map((p, i) => {
    if (p.t === '=') return html`<span key=${i}>${p.s}</span>`;
    if (p.t === '-' && lado === 'antes') return html`<del key=${i}>${p.s}</del>`;
    if (p.t === '+' && lado === 'depois') return html`<ins key=${i}>${p.s}</ins>`;
    return null;
  });
}

/** Resultado: resumo e as linhas que mudaram, com um pouco de contexto. */
export function VistaComparacao({ dados }) {
  const r = dados.resumo;
  const nada = !r.removidas && !r.adicionadas && !r.alteradas;
  const pagina = (l) => (l.t === '-' ? l.pa : l.pb || l.pa);
  return html`<div class="comparacao">
    <div class="comparacao-resumo">
      <span class="contagem menos"><b>${r.removidas}</b>removida${r.removidas === 1 ? '' : 's'}</span>
      <span class="contagem mais"><b>${r.adicionadas}</b>adicionada${r.adicionadas === 1 ? '' : 's'}</span>
      <span class="contagem"><b style="color:var(--aviso)">${r.alteradas}</b>alterada${r.alteradas === 1 ? '' : 's'}</span>
      <span class="contagem"><b>${r.iguais}</b>igua${r.iguais === 1 ? 'l' : 'is'}</span>
    </div>
    ${nada
      ? html`<div class="alerta ok"><${Icone} nome="okCirculo" tam=${17} /> O texto dos dois documentos é igual.</div>`
      : html`<div class="diff" role="table" aria-label="Diferenças">
        ${dados.linhas.map((l, i) => {
          if (l.t === 'pulo') return html`<div class="diff-pulo" key=${i}>… ${l.n} linha${l.n === 1 ? '' : 's'} igua${l.n === 1 ? 'l' : 'is'} …</div>`;
          if (l.t === '~') {
            return html`<div key=${i}>
              <div class="diff-linha menos"><span class="n">${l.pa ? `p.${l.pa}` : ''}</span><span class="n"></span><span class="s">−</span>
                <span class="t">${l.partes ? html`<${Partes} partes=${l.partes} lado="antes" />` : l.antes}</span></div>
              <div class="diff-linha mais"><span class="n"></span><span class="n">${l.pb ? `p.${l.pb}` : ''}</span><span class="s">+</span>
                <span class="t">${l.partes ? html`<${Partes} partes=${l.partes} lado="depois" />` : l.texto}</span></div>
            </div>`;
          }
          return html`<div key=${i} class=${cx('diff-linha', l.t === '-' && 'menos', l.t === '+' && 'mais')}>
            <span class="n">${l.t !== '+' && l.pa ? `p.${l.pa}` : ''}</span>
            <span class="n">${l.t !== '-' && pagina(l) ? `p.${pagina(l)}` : ''}</span>
            <span class="s">${l.t === '=' ? '' : l.t === '-' ? '−' : '+'}</span>
            <span class="t">${l.texto}</span>
          </div>`;
        })}
      </div>`}
    ${dados.cortado && html`<p style="color:var(--texto-3);font-size:12px">A lista foi cortada na tela; o relatório em PDF tem tudo.</p>`}
  </div>`;
}
