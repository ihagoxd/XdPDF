import { html, useState, plural, tamanho, semExtensao } from '../lib.js';
import { Icone } from '../icones.js';
import { POR_ID, sugestoesPara } from '../catalogo.js';
import { useLoja, api, avisar } from '../loja.js';
import { ir, Alerta, IconeArquivo, Ladrilho } from './base.js';
import { abrirVisualizador } from './visualizador.js';
import { guardarContinuacao } from './ferramenta.js';
import { VistaComparacao } from './comparar.js';

function ganho(r) {
  if (!r.original || !r.tamanho || r.tamanho >= r.original) return null;
  return Math.round((1 - r.tamanho / r.original) * 100);
}

export function Resultado({ ferramenta: f, tarefa, aoVoltar, aoRecomecar }) {
  const { sistema } = useLoja();
  const local = sistema && sistema.local;
  const lista = tarefa.resultados || [];
  const [salvando, setSalvando] = useState(false);
  const pdfs = lista.filter((r) => /\.pdf$/i.test(r.nome));
  const varios = lista.length > 1;
  const total = lista.reduce((s, r) => s + r.tamanho, 0);
  const totalOriginal = lista.reduce((s, r) => s + (r.original || 0), 0);
  const reducao = totalOriginal && total < totalOriginal ? Math.round((1 - total / totalOriginal) * 100) : null;

  const nomeZip = varios ? `${semExtensao(lista[0].nome).split(' - ')[0] || f.titulo}` : '';
  const urlZip = `/api/resultados/zip?ids=${lista.map((r) => r.id).join(',')}&nome=${encodeURIComponent(nomeZip)}`;

  const salvar = async () => {
    setSalvando(true);
    try {
      const d = await api.post('/resultados/salvar', { ids: lista.map((r) => r.id) });
      avisar(`${plural(d.salvos.length, 'arquivo salvo', 'arquivos salvos')} em ${d.pasta}`, 'ok');
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setSalvando(false);
    }
  };

  const continuar = async (id) => {
    try {
      const d = await api.post('/resultados/reaproveitar', { ids: pdfs.map((r) => r.id) });
      guardarContinuacao(d.arquivos);
      ir(`/f/${id}`);
    } catch (err) {
      avisar(err.message, 'erro');
    }
  };

  const titulo = f.id === 'comprimir' && reducao != null ? `Ficou ${reducao}% menor`
    : f.id === 'comprimir' ? 'Pronto'
    : varios ? `${plural(lista.length, 'arquivo pronto', 'arquivos prontos')}` : 'Pronto!';

  const subtitulo = f.id === 'comprimir' && reducao != null ? `De ${tamanho(totalOriginal)} para ${tamanho(total)}.`
    : f.id === 'comprimir' ? 'Este PDF já estava bem otimizado; quase não havia o que reduzir.'
    : varios ? `Total de ${tamanho(total)}.` : `${lista[0].nome} · ${tamanho(lista[0].tamanho)}`;

  const sugestoes = pdfs.length ? sugestoesPara('pdf').filter((id) => id !== f.id).slice(0, 6) : [];

  return html`<div class="resultado">
    <div class="resultado-icone"><${Icone} nome="check" tam=${36} espessura=${2.6} /></div>
    <div>
      <h2>${titulo}</h2>
      <p class="sub">${subtitulo}</p>
    </div>

    <div class="resultado-acoes">
      ${varios
        ? html`<a class="btn btn-primario btn-g" href=${urlZip} download><${Icone} nome="zip" tam=${19} /> Baixar tudo (.zip)</a>`
        : html`<a class="btn btn-primario btn-g" href=${`/api/resultados/${lista[0].id}`} download><${Icone} nome="baixar" tam=${19} /> Baixar ${lista[0].nome.split('.').pop().toUpperCase()}</a>`}
      ${!varios && pdfs.length === 1 && html`<button class="btn btn-g" onClick=${() => abrirVisualizador({ titulo: lista[0].nome, url: `/api/resultados/${lista[0].id}?ver=1` })}><${Icone} nome="olho" tam=${18} /> Visualizar</button>`}
      ${local && html`<button class="btn btn-g" onClick=${salvar} disabled=${salvando}><${Icone} nome="pasta" tam=${18} /> Salvar na pasta</button>`}
      ${local && !varios && html`<button class="btn btn-g" onClick=${() => api.post(`/resultados/${lista[0].id}/abrir`).catch((e) => avisar(e.message, 'erro'))}><${Icone} nome="externo" tam=${18} /> Abrir</button>`}
    </div>

    ${tarefa.avisos && tarefa.avisos.length > 0 && html`<div class="avisos-resultado">
      ${tarefa.avisos.map((a) => html`<${Alerta} nivel="aviso" key=${a}>${a}<//>`)}
    </div>`}

    ${f.id === 'comparar' && tarefa.dados && html`<div style="width:100%;text-align:left"><${VistaComparacao} dados=${tarefa.dados} /></div>`}

    ${(varios || f.id === 'comprimir') && html`<div class="lista-resultados">
      ${lista.map((r) => html`<div class="item-resultado" key=${r.id}>
        <${IconeArquivo} nome=${r.nome} p />
        <span class="nome" title=${r.nome}>${r.nome}</span>
        ${ganho(r) != null && html`<span class="ganho">−${ganho(r)}%</span>`}
        <span class="meta">${r.paginas ? `${plural(r.paginas, 'pág.', 'págs.')} · ` : ''}${tamanho(r.tamanho)}</span>
        ${/\.pdf$/i.test(r.nome) && html`<button class="btn-icone p" title="Visualizar" onClick=${() => abrirVisualizador({ titulo: r.nome, url: `/api/resultados/${r.id}?ver=1` })}><${Icone} nome="olho" tam=${16} /></button>`}
        <a class="btn-icone p" href=${`/api/resultados/${r.id}`} download title="Baixar este"><${Icone} nome="baixar" tam=${16} /></a>
      </div>`)}
    </div>`}

    <div class="resultado-acoes">
      <button class="btn btn-fantasma" onClick=${aoVoltar}><${Icone} nome="voltar" tam=${17} /> Voltar e ajustar</button>
      <button class="btn btn-fantasma" onClick=${aoRecomecar}><${Icone} nome="recarregar" tam=${17} /> Começar de novo</button>
    </div>

    ${sugestoes.length > 0 && html`<div class="continuar">
      <h4>Continuar com ${pdfs.length === 1 ? 'este arquivo' : 'estes arquivos'}</h4>
      <div class="continuar-grade">
        ${sugestoes.map((id) => POR_ID[id] && html`<button class="continuar-item" key=${id} onClick=${() => continuar(id)}>
          <${Ladrilho} ferramenta=${POR_ID[id]} tam="p" /> ${POR_ID[id].titulo}
        </button>`)}
      </div>
    </div>`}
  </div>`;
}
