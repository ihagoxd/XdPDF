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

  return html`<div class="app">
    <${Lateral} rota=${rota} aoBuscar=${() => setPaleta(true)} categoria=${categoria} aoCategoria=${setCategoria} />
    <main class="principal" id="principal">
      ${sistema && !conectado && html`<div class="pagina" style="padding-bottom:0">
        <div class="alerta aviso">Sem conexão com o XdPDF. Se você fechou a janela preta ou o programa, abra de novo.</div>
      </div>`}
      ${tela}
    </main>
    ${paleta && html`<${Paleta} aoFechar=${() => setPaleta(false)} />`}
    <${Toasts} />
  </div>`;
}

async function iniciar() {
  conectarEventos();
  try {
    await carregarSistema();
  } catch (_) {
    avisar('Não consegui falar com o servidor do XdPDF.', 'erro');
  }
  render(html`<${App} />`, document.getElementById('app'));
  if (!location.hash) ir('/');
}

iniciar();

// Instala como aplicativo (Edge/Chrome) e funciona como janela própria.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
