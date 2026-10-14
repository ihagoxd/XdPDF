import { html, useState, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar, useLoja, carregarSistema } from '../loja.js';

function Capacidade({ ok, titulo, detalhe }) {
  return html`<div class="capacidade">
    <span class=${cx('ponto-estado', ok ? 'ok' : 'nao')}></span>
    <div class="texto">${titulo}<small>${detalhe}</small></div>
    <span style=${`font-size:12px;font-weight:600;color:var(${ok ? '--ok' : '--aviso'})`}>${ok ? 'Disponível' : 'Não encontrado'}</span>
  </div>`;
}

export function Configuracoes() {
  const { sistema } = useLoja();
  const cfg = (sistema && sistema.config) || {};
  const cap = (sistema && sistema.capacidades) || {};
  const [pasta, setPasta] = useState(cfg.pastaSaida || '');
  const [abrir, setAbrir] = useState(cfg.abrirPastaAoSalvar !== false);

  const salvar = async () => {
    try {
      await api.put('/config', { pastaSaida: pasta, abrirPastaAoSalvar: abrir });
      await carregarSistema();
      avisar('Configurações salvas.', 'ok');
    } catch (e) { avisar(e.message, 'erro'); }
  };

  const office = cap.office || {};
  return html`<div class="pagina">
    <div class="ferramenta-topo">
      <span class="ic-acao g"><${Icone} nome="config" tam=${24} /></span>
      <div><h1>Configurações</h1><p>Onde salvar e o que esta máquina consegue fazer.</p></div>
    </div>

    <div class="config-grade">
      <div class="painel config-cartao">
        <h3>Pasta de saída</h3>
        <div class="campo">
          <label for="pasta">Ao clicar em "Salvar na pasta", os arquivos vão para:</label>
          <div class="campo-linha">
            <input id="pasta" class="entrada" type="text" value=${pasta} onInput=${(e) => setPasta(e.currentTarget.value)} spellcheck="false" />
            ${sistema && sistema.local && html`<button class="btn" style="flex:0 0 auto" onClick=${() => api.post('/abrir-pasta').catch((e) => avisar(e.message, 'erro'))}><${Icone} nome="pastaAberta" tam=${16} /> Abrir</button>`}
          </div>
        </div>
        <label class=${cx('alternar', abrir && 'ligado')} onClick=${() => setAbrir(!abrir)}>
          <span class="trilho"></span>
          <span class="texto"><strong>Abrir a pasta depois de salvar</strong><small>Mostra o arquivo já selecionado no Explorer.</small></span>
        </label>
        <div><button class="btn btn-primario" onClick=${salvar}><${Icone} nome="check" tam=${16} /> Salvar</button></div>
      </div>

      <div class="painel config-cartao">
        <h3>O que está instalado</h3>
        <div>
          <${Capacidade} ok=${office.word} titulo="Microsoft Word" detalhe="Word para PDF com fidelidade total" />
          <${Capacidade} ok=${office.excel} titulo="Microsoft Excel" detalhe="Excel para PDF" />
          <${Capacidade} ok=${office.powerpoint} titulo="Microsoft PowerPoint" detalhe="PowerPoint para PDF" />
          <${Capacidade} ok=${cap.libreoffice} titulo="LibreOffice" detalhe="Alternativa gratuita quando o Office não está instalado" />
          <${Capacidade} ok=${cap.navegador} titulo="Microsoft Edge / Google Chrome" detalhe="Site para PDF e a janela do aplicativo" />
          <${Capacidade} ok=${cap.ocr && cap.ocr.por} titulo="OCR em português" detalhe="Reconhecer texto de digitalizados" />
          <${Capacidade} ok=${cap.ghostscript} titulo="Ghostscript (opcional)" detalhe="Compressão extra e PDF/A mais rigoroso" />
        </div>
      </div>

      <div class="painel config-cartao">
        <h3>Sobre</h3>
        <p style="color:var(--texto-2)">XdPDF ${sistema ? sistema.versao : ''} — todas as operações acontecem neste computador. Os arquivos enviados são apagados em até 12 horas e os resultados em 7 dias.</p>
        <p style="color:var(--texto-2)">Atalhos: <kbd>Ctrl</kbd> + <kbd>K</kbd> procura ferramentas · <kbd>Ctrl</kbd> + <kbd>O</kbd> adiciona arquivos · <kbd>Esc</kbd> fecha janelas.</p>
      </div>
    </div>
  </div>`;
}
