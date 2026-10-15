import { html, useState, useEffect, tamanho, dataRelativa, plural } from '../lib.js';
import { Icone } from '../icones.js';
import { POR_ID } from '../catalogo.js';
import { api, avisar, useLoja } from '../loja.js';
import { IconeArquivo, ir } from './base.js';
import { abrirVisualizador } from './visualizador.js';
import { guardarContinuacao } from './ferramenta.js';

export function Recentes() {
  const { recentesVersao, sistema } = useLoja();
  const [lista, setLista] = useState(null);
  const local = sistema && sistema.local;

  const carregar = () => api.get('/resultados').then((d) => setLista(d.resultados)).catch((e) => avisar(e.message, 'erro'));
  useEffect(() => { carregar(); }, [recentesVersao]);

  const apagar = async (ids) => {
    await api.post('/resultados/remover', { ids });
    carregar();
  };

  const salvar = async (r) => {
    try {
      const d = await api.post('/resultados/salvar', { ids: [r.id] });
      avisar(`Salvo em ${d.pasta}`, 'ok');
    } catch (e) { avisar(e.message, 'erro'); }
  };

  const continuar = async (r) => {
    try {
      const d = await api.post('/resultados/reaproveitar', { ids: [r.id] });
      guardarContinuacao(d.arquivos);
      ir('/');
      avisar('Escolha a ferramenta para continuar com este arquivo.', 'info');
    } catch (e) { avisar(e.message, 'erro'); }
  };

  return html`<div class="pagina">
    <div class="ferramenta-topo">
      <span class="ic-acao g"><${Icone} nome="relogio" tam=${24} /></span>
      <div>
        <h1>Arquivos recentes</h1>
        <p>O que você gerou nos últimos 7 dias. Depois disso, a faxina automática apaga.</p>
      </div>
      ${lista && lista.length > 0 && html`<div class="acoes">
        <button class="btn btn-perigo" onClick=${() => { if (confirm(`Apagar ${plural(lista.length, 'arquivo', 'arquivos')} da lista?`)) apagar(lista.map((r) => r.id)); }}>
          <${Icone} nome="lixo" tam=${16} /> Limpar tudo
        </button>
      </div>`}
    </div>

    ${lista === null && html`<div class="vazio-estado">Carregando...</div>`}
    ${lista && lista.length === 0 && html`<div class="vazio-estado">
      <${Icone} nome="relogio" tam=${40} />
      <strong>Nada por aqui ainda</strong>
      Os arquivos que você gerar nas ferramentas aparecem aqui.
      <button class="btn btn-primario" onClick=${() => ir('/')}>Ver ferramentas</button>
    </div>`}

    ${lista && lista.length > 0 && html`<div class="lista-recentes">
      ${lista.map((r) => html`<div class="linha-recente" key=${r.id}>
        <${IconeArquivo} nome=${r.nome} />
        <div class="texto">
          <strong title=${r.nome}>${r.nome}</strong>
          <small>${tamanho(r.tamanho)}${r.paginas ? ` · ${plural(r.paginas, 'página', 'páginas')}` : ''} · ${dataRelativa(r.criadoEm)}${r.ferramenta && POR_ID[r.ferramenta] ? ` · ${POR_ID[r.ferramenta].titulo}` : ''}</small>
        </div>
        <div class="acoes-linha">
        ${/\.pdf$/i.test(r.nome) && html`<button class="btn-icone" title="Visualizar" onClick=${() => abrirVisualizador({ titulo: r.nome, url: `/api/resultados/${r.id}?ver=1` })}><${Icone} nome="olho" /></button>`}
        ${/\.pdf$/i.test(r.nome) && html`<button class="btn-icone" title="Usar em outra ferramenta" onClick=${() => continuar(r)}><${Icone} nome="seta" /></button>`}
        ${local && html`<button class="btn-icone" title="Salvar na pasta" onClick=${() => salvar(r)}><${Icone} nome="pasta" /></button>`}
        <a class="btn-icone" href=${`/api/resultados/${r.id}`} download title="Baixar"><${Icone} nome="baixar" /></a>
        <button class="btn-icone" title="Tirar da lista e apagar" onClick=${() => apagar([r.id])}><${Icone} nome="lixo" /></button>
        </div>
      </div>`)}
    </div>`}
  </div>`;
}
