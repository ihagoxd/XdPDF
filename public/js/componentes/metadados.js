import { html, useState, useEffect, plural, tamanho } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar } from '../loja.js';
import { Alerta, Anel } from './base.js';
import { MiniaturaArquivo } from './area-arquivos.js';
import { Alternar } from './opcoes.js';

const CAMPOS = [
  { chave: 'titulo', rotulo: 'Título' },
  { chave: 'autor', rotulo: 'Autor' },
  { chave: 'assunto', rotulo: 'Assunto' },
  { chave: 'palavrasChave', rotulo: 'Palavras-chave', ajuda: 'Separe por vírgula.' },
  { chave: 'criador', rotulo: 'Programa que criou' },
  { chave: 'produtor', rotulo: 'Programa que gerou o PDF' },
];

function data(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return '—'; }
}

export function AreaMetadados({ arquivo, extra, setExtra, aoTrocar }) {
  const [info, setInfo] = useState(null);
  const campos = extra.campos || {};

  useEffect(() => {
    if (!arquivo || arquivo.estado !== 'pronto') return;
    setInfo(null);
    api.get(`/arquivos/${arquivo.id}/info`).then((d) => {
      setInfo(d.info);
      const inicial = {};
      for (const c of CAMPOS) inicial[c.chave] = d.info[c.chave] || '';
      setExtra((x) => ({ ...x, campos: { ...inicial, limpar: false } }));
    }).catch((e) => avisar(e.message, 'erro'));
  }, [arquivo && arquivo.id, arquivo && arquivo.estado]);

  if (!arquivo || arquivo.estado !== 'pronto' || !info) {
    return html`<div class="painel" style="padding:40px;display:grid;place-items:center"><${Anel} /></div>`;
  }

  const mudar = (chave, valor) => setExtra((x) => ({ ...x, campos: { ...(x.campos || {}), [chave]: valor } }));

  return html`<div class="painel meta-grade" style="padding:20px;display:grid;grid-template-columns:150px minmax(0,1fr);gap:20px;align-items:start">
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="cartao-arquivo" style="padding:8px"><div class="miniatura-caixa" style="height:190px"><${MiniaturaArquivo} a=${arquivo} /></div></div>
      <div style="font-size:12px;color:var(--texto-3);line-height:1.6">
        ${plural(info.paginas, 'página', 'páginas')} · ${tamanho(info.tamanho)}<br />
        PDF ${info.versao || '—'}<br />
        Criado: ${data(info.criadoEm)}<br />
        Alterado: ${data(info.modificadoEm)}
      </div>
      <button class="btn btn-p" onClick=${aoTrocar}><${Icone} nome="arquivo" tam=${15} /> Outro PDF</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <${Alternar} ligado=${Boolean(campos.limpar)} aoMudar=${(v) => mudar('limpar', v)}
        titulo="Apagar todos os metadados" ajuda="Tira autor, programa, datas e o XMP. Bom antes de enviar para fora." />
      ${campos.limpar
        ? html`<${Alerta} nivel="info">O PDF vai sair sem nenhuma informação de autoria.<//>`
        : CAMPOS.map((c) => html`<div class="campo" key=${c.chave}>
            <label for=${`meta-${c.chave}`}>${c.rotulo}</label>
            <input id=${`meta-${c.chave}`} type="text" value=${campos[c.chave] || ''} onInput=${(e) => mudar(c.chave, e.currentTarget.value)} />
            ${c.ajuda && html`<span class="ajuda">${c.ajuda}</span>`}
          </div>`)}
    </div>
  </div>`;
}
