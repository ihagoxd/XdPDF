import { html } from '../lib.js';
import { Icone } from '../icones.js';
import { Ladrilho, ir } from './base.js';

// Versão provisória enquanto a bancada completa é montada.
export function Ferramenta({ ferramenta: f }) {
  return html`<div class="pagina">
    <div class="trilha"><button onClick=${() => ir('/')}>Início</button><${Icone} nome="direita" tam=${14} /><span>${f.titulo}</span></div>
    <div class="ferramenta-topo"><${Ladrilho} ferramenta=${f} tam="g" /><div><h1>${f.titulo}</h1><p>${f.descricao}</p></div></div>
    <div class="zona-soltar" style=${`--cor:${f.cor}`}>
      <div class="zona-icone"><${Icone} nome="enviar" tam=${34} /></div>
      <h2>Em construção</h2>
      <p>Esta tela está sendo montada agora.</p>
    </div>
  </div>`;
}
