import { html, render, useState, useEffect } from './lib.js';
import { useLoja, conectarEventos, carregarSistema, avisar } from './loja.js';
import { useRota, useAtalho, Toasts, ir } from './componentes/base.js';
import { Lateral } from './componentes/lateral.js';
import { Inicio } from './componentes/inicio.js';
import { Paleta } from './componentes/paleta.js';
import { Ferramenta } from './componentes/ferramenta.js';
import { Recentes } from './componentes/recentes.js';
import { Configuracoes } from './componentes/configuracoes.js';
import { POR_ID } from './catalogo.js';
import { Icone } from './icones.js';

function App() {
  const rota = useRota();
  const { sistema, conectado } = useLoja();
  const [paleta, setPaleta] = useState(false);
  const [categoria, setCategoria] = useState(null);

  useAtalho((e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k', () => setPaleta((p) => !p));

  // título da janela acompanha a tela
  useEffect(() => {
    const f = rota.tela === 'f' && POR_ID[rota.param];
    document.title = f ? `${f.titulo} · XdPDF`
      : rota.tela === 'recentes' ? 'Recentes · XdPDF'
      : rota.tela === 'config' ? 'Configurações · XdPDF'
      : 'XdPDF';
    const principal = document.querySelector('.principal');
    if (principal) principal.scrollTop = 0;
  }, [rota.tela, rota.param]);

  let tela;
  if (rota.tela === 'f' && POR_ID[rota.param]) {
    tela = html`<${Ferramenta} key=${rota.param} ferramenta=${POR_ID[rota.param]} />`;
  } else if (rota.tela === 'recentes') {
    tela = html`<${Recentes} />`;
  } else if (rota.tela === 'config') {
    tela = html`<${Configuracoes} />`;
  } else {
    tela = html`<${Inicio} categoria=${categoria} aoCategoria=${setCategoria} />`;
  }

  const emFerramenta = rota.tela === 'f';

  return html`<div class=${emFerramenta ? 'app em-ferramenta' : 'app'}>
    <${Lateral} rota=${rota} aoBuscar=${() => setPaleta(true)} categoria=${categoria} aoCategoria=${setCategoria} />
    <${TopoMovel} rota=${rota} aoBuscar=${() => setPaleta(true)} />
    <main class="principal" id="principal">
      ${sistema && !conectado && html`<div class="pagina" style="padding-bottom:0">
        <div class="alerta aviso">Sem conexão com o XdPDF. Tentando de novo... Se o programa foi fechado, abra o XdPDF outra vez.</div>
      </div>`}
      ${tela}
    </main>
    <${AbasMovel} rota=${rota} aoBuscar=${() => setPaleta(true)} aoInicio=${() => setCategoria(null)} />
    ${paleta && html`<${Paleta} aoFechar=${() => setPaleta(false)} />`}
    <${Toasts} />
  </div>`;
}

/* ---------------- celular: barra de cima e abas de baixo ---------------- */

function TopoMovel({ rota, aoBuscar }) {
  const f = rota.tela === 'f' && POR_ID[rota.param];
  return html`<header class="topo-movel">
    ${f
      ? html`<button class="btn-icone" onClick=${() => (history.length > 1 ? history.back() : ir('/'))} aria-label="Voltar"><${Icone} nome="voltar" tam=${21} /></button>
        <span class="topo-movel-titulo">${f.titulo}</span>`
      : html`<a class="marca" href="#/" aria-label="XdPDF">
          <img class="marca-logo" src="/icones/xdpdf.svg" alt="" />
          <span class="marca-nome"><b>Xd</b>PDF</span>
        </a>`}
    <button class="btn-icone" onClick=${aoBuscar} aria-label="Procurar ferramenta"><${Icone} nome="busca" tam=${20} /></button>
  </header>`;
}

function AbasMovel({ rota, aoBuscar, aoInicio }) {
  const aba = (id, rotulo, icone, acao, ativo) => html`<button class=${ativo ? 'aba ativo' : 'aba'} onClick=${acao} aria-current=${ativo ? 'page' : undefined}>
    <${Icone} nome=${icone} tam=${22} /><span>${rotulo}</span>
  </button>`;
  return html`<nav class="abas-movel" aria-label="Navegação">
    ${aba('inicio', 'Ferramentas', 'organizar', () => { aoInicio(); ir('/'); }, rota.tela === 'inicio')}
    ${aba('buscar', 'Procurar', 'busca', aoBuscar, false)}
    ${aba('recentes', 'Recentes', 'relogio', () => ir('/recentes'), rota.tela === 'recentes')}
    ${aba('config', 'Ajustes', 'config', () => ir('/config'), rota.tela === 'config')}
  </nav>`;
}

function iniciar() {
  conectarEventos();
  // desenha na hora; o que esta máquina tem instalado chega logo depois
  render(html`<${App} />`, document.getElementById('app'));
  if (!location.hash) ir('/');
  carregarSistema().catch(() => avisar('Não consegui falar com o servidor do XdPDF.', 'erro'));
}

iniciar();

// Instala como aplicativo (Edge/Chrome) e funciona como janela própria.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
