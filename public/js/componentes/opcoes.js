import { html, useState, useRef, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { Alerta } from './base.js';

const ROTULOS_POSICAO = {
  'sup-esq': 'No alto, à esquerda', 'sup-centro': 'No alto, no centro', 'sup-dir': 'No alto, à direita',
  'meio-esq': 'No meio, à esquerda', centro: 'No centro', 'meio-dir': 'No meio, à direita',
  'inf-esq': 'Embaixo, à esquerda', 'inf-centro': 'Embaixo, no centro', 'inf-dir': 'Embaixo, à direita',
};
const ORDEM_POSICOES = Object.keys(ROTULOS_POSICAO);

const CORES = ['#111111', '#333333', '#6b7280', '#d92d20', '#1d4ed8', '#047857', '#7c3aed'];

export function Alternar({ ligado, aoMudar, titulo, ajuda }) {
  return html`<label class=${cx('alternar', ligado && 'ligado')}
      role="switch" aria-checked=${ligado ? 'true' : 'false'} tabIndex="0"
      onClick=${(e) => { e.preventDefault(); aoMudar(!ligado); }}
      onKeyDown=${(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); aoMudar(!ligado); } }}>
    <span class="trilho"></span>
    <span class="texto"><strong>${titulo}</strong>${ajuda && html`<small>${ajuda}</small>`}</span>
  </label>`;
}

export function Segmentado({ valor, opcoes, aoMudar, rotulo }) {
  return html`<div class="segmentado" role="radiogroup" aria-label=${rotulo}>
    ${opcoes.map((o) => html`<button key=${o.valor} type="button" role="radio" aria-checked=${String(valor) === String(o.valor)}
      class=${cx(String(valor) === String(o.valor) && 'ativo')} onClick=${() => aoMudar(o.valor)} title=${o.dica || ''}>${o.rotulo}</button>`)}
  </div>`;
}

function CampoSenha({ valor, confirmacao = '', aoMudar, confirmar }) {
  const [ver, setVer] = useState(false);
  const diferente = confirmar && confirmacao && confirmacao !== valor;
  return html`<div style="display:flex;flex-direction:column;gap:8px">
    <div class="campo-linha">
      <input type=${ver ? 'text' : 'password'} value=${valor} autocomplete="new-password" placeholder="Digite a senha"
        onInput=${(e) => aoMudar(e.currentTarget.value, confirmacao)} />
      <button type="button" class="btn-icone" style="flex:0 0 auto" onClick=${() => setVer(!ver)} title=${ver ? 'Esconder' : 'Mostrar'}>
        <${Icone} nome=${ver ? 'tarjar' : 'olho'} tam=${17} />
      </button>
    </div>
    ${confirmar && html`<input type=${ver ? 'text' : 'password'} value=${confirmacao} autocomplete="new-password" placeholder="Repita a senha"
      onInput=${(e) => aoMudar(valor, e.currentTarget.value)} />`}
    ${diferente && html`<span class="ajuda" style="color:var(--erro)">As senhas não conferem.</span>`}
  </div>`;
}

function CampoImagem({ valor, aoMudar }) {
  const entrada = useRef(null);
  const escolher = (arquivo) => {
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => aoMudar(leitor.result);
    leitor.readAsDataURL(arquivo);
  };
  return html`<div>
    <input ref=${entrada} type="file" accept="image/png,image/jpeg" hidden onChange=${(e) => escolher(e.currentTarget.files[0])} />
    ${valor
      ? html`<div style="display:flex;gap:10px;align-items:center">
          <img src=${valor} alt="" style="max-height:64px;max-width:140px;border-radius:8px;border:1px solid var(--linha);background:#fff" />
          <button type="button" class="btn btn-p" onClick=${() => entrada.current.click()}>Trocar</button>
          <button type="button" class="btn-icone" onClick=${() => aoMudar('')} title="Tirar"><${Icone} nome="x" tam=${16} /></button>
        </div>`
      : html`<button type="button" class="btn btn-bloco" onClick=${() => entrada.current.click()}><${Icone} nome="imagem" tam=${16} /> Escolher imagem</button>`}
  </div>`;
}

/** Desenha um campo de opção a partir da definição do catálogo. */
function Campo({ def, valor, aoMudar, opcoes, aoMudarVarios }) {
  const id = `op-${def.chave}`;
  let corpo;
  switch (def.tipo) {
    case 'alternar':
      return html`<${Alternar} ligado=${Boolean(valor)} aoMudar=${aoMudar} titulo=${def.rotulo} ajuda=${def.ajuda} />`;
    case 'aviso':
      return html`<${Alerta} nivel=${def.nivel || 'info'}>${def.texto}<//>`;
    case 'segmentado':
      corpo = html`<${Segmentado} valor=${valor} opcoes=${def.opcoes} aoMudar=${aoMudar} rotulo=${def.rotulo} />`;
      break;
    case 'escolhas':
      corpo = html`<div class="escolhas" role="radiogroup" aria-label=${def.rotulo}>
        ${def.opcoes.map((o) => html`<button type="button" key=${o.valor} role="radio" aria-checked=${valor === o.valor}
          class=${cx('escolha', valor === o.valor && 'ativo')} onClick=${() => aoMudar(o.valor)}>
          <span class="radio"></span><span><strong>${o.rotulo}</strong>${o.dica && html`<small>${o.dica}</small>`}</span>
        </button>`)}
      </div>`;
      break;
    case 'selecao':
      corpo = html`<select id=${id} value=${valor} onChange=${(e) => aoMudar(e.currentTarget.value)}>
        ${def.opcoes.map((o) => html`<option key=${o.valor} value=${o.valor}>${o.rotulo}</option>`)}
      </select>`;
      break;
    case 'numero':
      corpo = html`<div class="campo-linha">
        <input id=${id} type="number" inputmode="decimal" value=${valor} min=${def.min} max=${def.max} step=${def.passo || 1}
          onInput=${(e) => aoMudar(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))} />
        ${def.unidade && html`<span class="unidade">${def.unidade}</span>`}
      </div>`;
      break;
    case 'faixa':
      corpo = html`<div class="faixa">
        <input id=${id} type="range" min=${def.min} max=${def.max} step=${def.passo || 1} value=${valor}
          onInput=${(e) => aoMudar(Number(e.currentTarget.value))} />
        <output for=${id}>${valor}${def.unidade ? ` ${def.unidade}` : ''}</output>
      </div>`;
      break;
    case 'posicao':
      corpo = html`<div class="posicoes" role="radiogroup" aria-label=${def.rotulo}>
        ${ORDEM_POSICOES.map((p) => {
          const pode = !def.permitidas || def.permitidas.includes(p);
          return html`<button type="button" key=${p} class=${cx(valor === p && 'ativo', !pode && 'vazio')}
            disabled=${!pode} title=${ROTULOS_POSICAO[p]} aria-label=${ROTULOS_POSICAO[p]} role="radio" aria-checked=${valor === p}
            onClick=${() => aoMudar(p)}></button>`;
        })}
      </div>`;
      break;
    case 'cor':
      corpo = html`<div class="cores">
        ${CORES.map((c) => html`<button type="button" key=${c} class=${cx(valor === c && 'ativo')} style=${`background:${c}`}
          onClick=${() => aoMudar(c)} aria-label=${`Cor ${c}`}></button>`)}
        <input type="color" value=${valor} onInput=${(e) => aoMudar(e.currentTarget.value)} title="Outra cor" />
      </div>`;
      break;
    case 'senha':
      corpo = html`<${CampoSenha} valor=${valor || ''} confirmar=${def.confirmar} confirmacao=${opcoes[`${def.chave}Confirmacao`] || ''}
        aoMudar=${(v, conf) => aoMudarVarios({ [def.chave]: v, [`${def.chave}Confirmacao`]: conf })} />`;
      break;
    case 'area':
      corpo = html`<textarea id=${id} rows="7" spellcheck="false" placeholder=${def.placeholder || ''}
        onInput=${(e) => aoMudar(e.currentTarget.value)}>${valor}</textarea>`;
      break;
    case 'imagem':
      corpo = html`<${CampoImagem} valor=${valor} aoMudar=${aoMudar} />`;
      break;
    case 'intervalo':
    case 'texto':
    default:
      corpo = html`<input id=${id} type="text" value=${valor} placeholder=${def.placeholder || ''} spellcheck="false"
        autocomplete="off" inputmode=${def.tipo === 'intervalo' ? 'numeric' : undefined}
        onInput=${(e) => aoMudar(e.currentTarget.value)} />`;
  }
  return html`<div class="campo">
    <label for=${id} class="rotulo">${def.rotulo}</label>
    ${corpo}
    ${def.ajuda && def.tipo !== 'alternar' && html`<span class="ajuda">${def.ajuda}</span>`}
  </div>`;
}

/** Lista de campos visíveis conforme as opções atuais. */
export function CamposOpcoes({ definicoes, opcoes, aoMudar }) {
  const visiveis = (definicoes || []).filter((d) => !d.quando || d.quando(opcoes));
  return visiveis.map((def) => html`<${Campo} key=${def.chave} def=${def} valor=${opcoes[def.chave]} opcoes=${opcoes}
    aoMudar=${(v) => aoMudar({ ...opcoes, [def.chave]: v })}
    aoMudarVarios=${(obj) => aoMudar({ ...opcoes, ...obj })} />`);
}
