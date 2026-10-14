import { html, useState, useEffect, useRef, useMemo, cx, plural, extensao, preferencias } from '../lib.js';
import { Icone } from '../icones.js';
import { opcoesPadrao, indisponivel } from '../catalogo.js';
import { useLoja, api, avisar, enviarArquivos, aguardarTarefa, mudar } from '../loja.js';
import { ir, Ladrilho, Alerta, Dialogo, Anel, useAtalho } from './base.js';
import { CamposOpcoes } from './opcoes.js';
import { AreaArquivos } from './area-arquivos.js';
import { AreaPaginas, opcoesDasPaginas, resumoPaginas } from './area-paginas.js';
import { Editor } from './editor.js';
import { AreaComparar } from './comparar.js';
import { AreaMetadados } from './metadados.js';
import { Resultado } from './resultado.js';

/* ---------------- continuar com o resultado de outra ferramenta ---------------- */

export function guardarContinuacao(arquivos) {
  mudar((e) => { for (const a of arquivos) e.arquivos[a.id] = a; });
  try { sessionStorage.setItem('xdpdf-continuar', JSON.stringify(arquivos.map((a) => a.id))); } catch (_) { /* ok */ }
}

function lerContinuacao() {
  try {
    const ids = JSON.parse(sessionStorage.getItem('xdpdf-continuar') || '[]');
    sessionStorage.removeItem('xdpdf-continuar');
    return Array.isArray(ids) ? ids : [];
  } catch (_) {
    return [];
  }
}

/* ---------------- opções lembradas por ferramenta ---------------- */

const NAO_LEMBRAR = new Set(['senha', 'senhaConfirmacao', 'imagem', 'html', 'endereco']);

function opcoesIniciais(f) {
  const guardadas = preferencias.ler(`opcoes-${f.id}`, {});
  const base = opcoesPadrao(f);
  for (const [k, v] of Object.entries(guardadas)) if (k in base && !NAO_LEMBRAR.has(k)) base[k] = v;
  return base;
}

function lembrarOpcoes(f, opcoes) {
  const copia = {};
  for (const [k, v] of Object.entries(opcoes)) if (!NAO_LEMBRAR.has(k)) copia[k] = v;
  preferencias.gravar(`opcoes-${f.id}`, copia);
}

/* ---------------- aceitação de arquivos ---------------- */

function aceita(f, arquivo) {
  const ext = `.${extensao(arquivo.name)}`;
  return f.extensoes ? f.extensoes.split(',').includes(ext) : true;
}

function rotuloTipos(f) {
  const exts = (f.extensoes || '').split(',').map((e) => e.replace('.', '').toUpperCase());
  const unicos = Array.from(new Set(exts.map((e) => (e === 'JPEG' || e === 'JFIF' ? 'JPG' : e === 'TIF' ? 'TIFF' : e))));
  if (unicos.length > 7) return `${unicos.slice(0, 6).join(', ')} e outros`;
  return unicos.join(', ');
}

/* ============================================================
   TELA DA FERRAMENTA
   ============================================================ */

export function Ferramenta({ ferramenta: f }) {
  const loja = useLoja();
  const cap = loja.sistema && loja.sistema.capacidades;
  const motivo = indisponivel(f, cap);

  const [ids, setIds] = useState(lerContinuacao);
  const [opcoes, setOpcoesBruto] = useState(() => opcoesIniciais(f));
  const [extra, setExtra] = useState({});
  const [envio, setEnvio] = useState(null);
  const [tarefaId, setTarefaId] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [senhaPara, setSenhaPara] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef(null);
  const camera = useRef(null);

  const setOpcoes = (novas) => { setOpcoesBruto(novas); lembrarOpcoes(f, novas); };

  const arquivos = ids.map((id) => loja.arquivos[id]).filter(Boolean);
  const tarefa = tarefaId ? loja.tarefas[tarefaId] : null;
  const processando = Boolean(tarefaId && (!tarefa || tarefa.estado === 'fila' || tarefa.estado === 'rodando'));
  const umSo = f.max === 1;

  /* ---------------- entrada de arquivos ---------------- */

  const adicionar = async (lista) => {
    if (!lista || !lista.length || envio) return;
    const bons = lista.filter((a) => aceita(f, a));
    const fora = lista.length - bons.length;
    if (fora) avisar(`${plural(fora, 'arquivo não serve', 'arquivos não servem')} para esta ferramenta (aceita ${rotuloTipos(f)}).`, 'aviso');
    if (!bons.length) return;
    let escolhidos = bons;
    if (umSo) escolhidos = bons.slice(0, 1);
    if (f.max && f.max > 1) {
      const vagas = f.max - (umSo ? 0 : ids.length);
      if (vagas <= 0) { avisar(`Esta ferramenta usa no máximo ${f.max} arquivos.`, 'aviso'); return; }
      escolhidos = bons.slice(0, vagas);
    }
    setEnvio({ pct: 0, n: escolhidos.length });
    try {
      const novos = await enviarArquivos(escolhidos, (pct) => setEnvio({ pct, n: escolhidos.length }));
      if (umSo) {
        if (ids.length) api.post('/arquivos/remover', { ids }).catch(() => {});
        setIds(novos.map((a) => a.id));
        setExtra({});
      } else {
        setIds((atual) => [...atual, ...novos.map((a) => a.id)]);
      }
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setEnvio(null);
    }
  };

  const escolherArquivos = () => { if (entrada.current) { entrada.current.value = ''; entrada.current.click(); } };

  const remover = (id) => {
    setIds((atual) => atual.filter((x) => x !== id));
    api.post('/arquivos/remover', { ids: [id] }).catch(() => {});
  };

  const limparTudo = () => {
    if (ids.length) api.post('/arquivos/remover', { ids }).catch(() => {});
    setIds([]);
    setExtra({});
  };

  useAtalho((e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o', escolherArquivos, [envio]);

  // soltar arquivos em qualquer lugar da janela
  useEffect(() => {
    if (f.semArquivos) return undefined;
    let contador = 0;
    const temArquivos = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const entrar = (e) => { if (!temArquivos(e)) return; e.preventDefault(); contador += 1; setArrastando(true); };
    const sobre = (e) => { if (!temArquivos(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const sair = (e) => { if (!temArquivos(e)) return; contador -= 1; if (contador <= 0) { contador = 0; setArrastando(false); } };
    const soltar = (e) => {
      if (!temArquivos(e)) return;
      e.preventDefault();
      contador = 0;
      setArrastando(false);
      adicionar(Array.from(e.dataTransfer.files || []));
    };
    window.addEventListener('dragenter', entrar);
    window.addEventListener('dragover', sobre);
    window.addEventListener('dragleave', sair);
    window.addEventListener('drop', soltar);
    return () => {
      window.removeEventListener('dragenter', entrar);
      window.removeEventListener('dragover', sobre);
      window.removeEventListener('dragleave', sair);
      window.removeEventListener('drop', soltar);
    };
  });

  /* ---------------- validação e execução ---------------- */

  const preparando = arquivos.filter((a) => a.estado === 'preparando');
  const comSenha = arquivos.filter((a) => a.estado === 'senha');
  const comErro = arquivos.filter((a) => a.estado === 'erro');
  const utilizaveis = arquivos.filter((a) => a.estado === 'pronto' || (f.aceitaComErro && a.estado === 'erro'));

  const problema = useMemo(() => {
    if (motivo) return motivo;
    if (f.semArquivos) {
      if (f.id === 'html-pdf') {
        if (opcoes.fonte === 'html' ? !String(opcoes.html || '').trim() : !String(opcoes.endereco || '').trim()) {
          return opcoes.fonte === 'html' ? 'Cole o código HTML.' : 'Digite o endereço da página.';
        }
      }
      return null;
    }
    if (!arquivos.length) return 'Adicione os arquivos.';
    if (preparando.length) return `Preparando ${plural(preparando.length, 'arquivo', 'arquivos')}...`;
    if (comSenha.length) return `${plural(comSenha.length, 'arquivo pede', 'arquivos pedem')} senha. Toque em "Digitar senha".`;
    if (!utilizaveis.length) return 'Nenhum arquivo pode ser usado. Veja os avisos nos cartões.';
    const min = f.min || 1;
    if (utilizaveis.length < min) return min === 2 ? 'Adicione pelo menos mais um arquivo.' : `Adicione pelo menos ${min} arquivos.`;
    if (f.id === 'proteger') {
      if (String(opcoes.senha || '').length < 4) return 'Escolha uma senha com pelo menos 4 caracteres.';
      if (opcoes.senha !== opcoes.senhaConfirmacao) return 'Repita a senha igual no segundo campo.';
    }
    if (f.id === 'marca-dagua') {
      if (opcoes.tipo === 'imagem' && !opcoes.imagem) return 'Escolha a imagem da marca d\'água.';
      if (opcoes.tipo !== 'imagem' && !String(opcoes.texto || '').trim()) return 'Digite o texto da marca d\'água.';
    }
    if (f.area === 'paginas') return resumoPaginas(f, arquivos, extra).problema;
    if (f.area === 'editor') {
      if (f.modoEditor === 'recortar') return extra.recorte ? null : 'Desenhe a área que deve ficar.';
      if (f.modoEditor === 'tarjar') return (extra.elementos || []).length ? null : 'Marque pelo menos um trecho para tarjar.';
      return (extra.elementos || []).length ? null : (f.modoEditor === 'assinar' ? 'Coloque a assinatura na página.' : 'Adicione algo na página.');
    }
    return null;
  }, [motivo, arquivos, opcoes, extra]);

  const montarOpcoes = () => {
    const o = { ...opcoes };
    delete o.senhaConfirmacao;
    if (f.area === 'paginas') Object.assign(o, opcoesDasPaginas(f, arquivos, extra));
    if (f.area === 'editor') {
      if (f.modoEditor === 'recortar') o.recorte = extra.recorte;
      else o.elementos = extra.elementos || [];
      if (extra.aplicarEm) o.aplicarEm = extra.aplicarEm;
      if (f.modoEditor === 'tarjar') o.ocr = Boolean(extra.ocr);
    }
    if (f.area === 'metadados') Object.assign(o, extra.campos || {});
    return o;
  };

  const executar = async () => {
    if (problema || processando) {
      if (problema) avisar(problema, 'aviso');
      return;
    }
    try {
      const d = await api.post(`/ferramentas/${f.servidor || f.id}`, {
        arquivos: utilizaveis.map((a) => a.id),
        opcoes: montarOpcoes(),
      });
      mudar((e) => { e.tarefas[d.tarefa.id] = d.tarefa; });
      setTarefaId(d.tarefa.id);
      const fim = await aguardarTarefa(d.tarefa.id);
      if (fim.estado === 'concluida') {
        setResultado(fim);
        const principal = document.querySelector('.principal');
        if (principal) principal.scrollTop = 0;
      } else if (fim.estado === 'erro') {
        avisar(fim.erro || 'Não deu certo.', 'erro', { titulo: 'Não foi possível concluir' });
      } else if (fim.estado === 'cancelada') {
        avisar('Operação cancelada.', 'info');
      }
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setTarefaId(null);
    }
  };

  const cancelar = () => { if (tarefaId) api.post(`/tarefas/${tarefaId}/cancelar`).catch(() => {}); };

  useAtalho((e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter', executar, [problema, processando, opcoes, extra, ids]);

  /* ---------------- partes da tela ---------------- */

  const inputs = html`
    <input ref=${entrada} type="file" hidden multiple=${!umSo} accept=${f.extensoes || ''}
      onChange=${(e) => adicionar(Array.from(e.currentTarget.files || []))} />
    ${f.id === 'imagem-pdf' && html`<input ref=${camera} type="file" hidden accept="image/*" capture="environment"
      onChange=${(e) => adicionar(Array.from(e.currentTarget.files || []))} />`}`;

  const botaoAcao = (classe = '') => html`<button class=${cx('btn btn-primario', classe)} disabled=${Boolean(problema) || processando}
      onClick=${executar} title=${problema || 'Ctrl + Enter'}>
    ${processando ? html`<${Anel} tam="p" />` : html`<${Icone} nome="check" tam=${18} />`}
    ${f.acao}
  </button>`;

  const topo = html`
    <div class="trilha">
      <button onClick=${() => ir('/')}>Ferramentas</button><${Icone} nome="direita" tam=${14} /><span>${f.titulo}</span>
    </div>
    <div class="ferramenta-topo">
      <${Ladrilho} ferramenta=${f} tam="g" />
      <div><h1>${f.titulo}</h1><p>${f.descricao}</p></div>
      ${!resultado && arquivos.length > 0 && !f.semArquivos && html`<div class="acoes">
        <button class="btn" onClick=${escolherArquivos} disabled=${Boolean(envio)}><${Icone} nome="mais" tam=${17} /> ${umSo ? 'Trocar arquivo' : 'Adicionar'}</button>
      </div>`}
    </div>`;

  let corpo;
  if (resultado) {
    corpo = html`<${Resultado} ferramenta=${f} tarefa=${resultado}
      aoVoltar=${() => setResultado(null)}
      aoRecomecar=${() => { setResultado(null); limparTudo(); }} />`;
  } else if (!f.semArquivos && !arquivos.length) {
    corpo = html`<div class=${cx('zona-soltar', arrastando && 'arrastando')} style=${`--cor:${f.cor}`}>
      <div class="zona-icone"><${Icone} nome="enviar" tam=${32} /></div>
      <h2>${umSo ? 'Escolha o arquivo' : 'Escolha os arquivos'}</h2>
      <p class="so-desktop">ou arraste e solte aqui</p>
      <button class="btn btn-primario btn-g" onClick=${escolherArquivos} disabled=${Boolean(motivo)}>
        <${Icone} nome="arquivo" tam=${18} /> ${umSo ? 'Selecionar arquivo' : 'Selecionar arquivos'}
      </button>
      ${f.id === 'imagem-pdf' && html`<button class="btn btn-g so-movel" onClick=${() => camera.current && camera.current.click()}>
        <${Icone} nome="imagem" tam=${18} /> Tirar foto do documento
      </button>`}
      <span class="dica-tipos">${rotuloTipos(f)}${umSo ? ' · um arquivo' : ''}</span>
      <span class="privacidade"><${Icone} nome="escudo" tam=${14} /> Os arquivos ficam neste computador</span>
    </div>`;
  } else if (f.area === 'editor') {
    corpo = html`<${Editor} ferramenta=${f} arquivo=${arquivos[0]} extra=${extra} setExtra=${setExtra}
      aoTrocar=${escolherArquivos} botao=${botaoAcao('btn-g btn-bloco')} problema=${problema} />`;
  } else {
    let area;
    if (f.area === 'paginas') {
      area = html`<${AreaPaginas} ferramenta=${f} arquivos=${arquivos} extra=${extra} setExtra=${setExtra}
        aoRemover=${remover} aoAdicionar=${escolherArquivos} aoSenha=${setSenhaPara} />`;
    } else if (f.area === 'comparar') {
      area = html`<${AreaComparar} arquivos=${arquivos} aoRemover=${remover} aoAdicionar=${escolherArquivos} aoSenha=${setSenhaPara} />`;
    } else if (f.area === 'metadados') {
      area = html`<${AreaMetadados} arquivo=${arquivos[0]} extra=${extra} setExtra=${setExtra} aoTrocar=${escolherArquivos} />`;
    } else if (f.area === 'site') {
      area = html`<div class="painel" style="padding:22px;display:flex;flex-direction:column;gap:12px">
        <${Alerta} nivel="info">A página é aberta por um navegador invisível aqui no computador, exatamente como apareceria na tela, e salva em PDF. Precisa de internet só para carregar o site.<//>
        <p style="color:var(--texto-2);font-size:13px">Dica: para páginas que pedem login, abra no navegador e use Ctrl+P → "Salvar como PDF".</p>
      </div>`;
    } else {
      area = html`<${AreaArquivos} ferramenta=${f} arquivos=${arquivos} ids=${ids} setIds=${setIds}
        aoRemover=${remover} aoAdicionar=${escolherArquivos} aoSenha=${setSenhaPara} enviando=${envio} />`;
    }

    const resumo = f.area === 'paginas' ? resumoPaginas(f, arquivos, extra).texto : null;
    corpo = html`<div class="bancada">
      <div class="bancada-area">
        ${comErro.length > 0 && !f.aceitaComErro && html`<div style="margin-bottom:12px"><${Alerta} nivel="aviso">
          ${plural(comErro.length, 'arquivo não pôde', 'arquivos não puderam')} ser lido e ${comErro.length === 1 ? 'vai' : 'vão'} ficar de fora.
          ${comErro.some((a) => /Reparar/.test(a.erro || '')) && html` Tente antes a ferramenta <a href="#/f/reparar">Reparar PDF</a>.`}
        <//></div>`}
        ${area}
      </div>
      <aside class="painel painel-opcoes" aria-label="Opções">
        <div class="painel-cab"><${Icone} nome="config" tam=${17} /><h3>Opções</h3></div>
        <div class="painel-corpo">
          ${(f.opcoes || []).length
            ? html`<${CamposOpcoes} definicoes=${f.opcoes} opcoes=${opcoes} aoMudar=${setOpcoes} />`
            : html`<p style="color:var(--texto-2);font-size:13px">${f.area === 'paginas' ? 'Use as páginas ao lado.' : 'Nada para ajustar: é só confirmar.'}</p>`}
          ${resumo && html`<div class="alerta">${resumo}</div>`}
        </div>
        <div class="painel-rodape">
          ${botaoAcao('btn-g btn-bloco')}
          ${problema && !processando && html`<span class="nota">${problema}</span>`}
        </div>
      </aside>
    </div>`;
  }

  return html`<div class="pagina" style=${`--cor:${f.cor}`}>
    ${inputs}
    ${topo}
    ${motivo && html`<div style="margin-bottom:16px"><${Alerta} nivel="aviso"><strong>Indisponível nesta máquina.</strong> ${motivo}<//></div>`}
    ${corpo}

    ${!resultado && (arquivos.length > 0 || f.semArquivos) && f.area !== 'editor' && html`<div class="barra-acao-movel">
      ${!f.semArquivos && !umSo && html`<button class="btn" onClick=${escolherArquivos} aria-label="Adicionar arquivos"><${Icone} nome="mais" tam=${20} /></button>`}
      ${botaoAcao()}
    </div>`}

    ${envio && html`<div class="capa"><div class="caixa-progresso">
      <h3>Enviando ${plural(envio.n, 'arquivo', 'arquivos')}</h3>
      <div class="barra"><div class="barra-preenche" style=${`width:${envio.pct}%`}></div></div>
      <span class="texto-progresso">${envio.pct < 100 ? `${envio.pct}%` : 'Lendo os arquivos...'}</span>
    </div></div>`}

    ${processando && html`<div class="capa"><div class="caixa-progresso" role="status">
      <${Ladrilho} ferramenta=${f} tam="g" />
      <h3>${tarefa && tarefa.estado === 'fila' ? 'Na fila...' : 'Trabalhando'}</h3>
      <div class=${cx('barra', (!tarefa || !tarefa.progresso) && 'indeterminada')}>
        <div class="barra-preenche" style=${`width:${tarefa ? tarefa.progresso : 0}%`}></div>
      </div>
      <span class="texto-progresso">${tarefa ? tarefa.texto : 'Começando...'}</span>
      <button class="btn btn-fantasma" onClick=${cancelar}>Cancelar</button>
    </div></div>`}

    ${arrastando && html`<div class="soltar-global"><div class="caixa">
      <${Icone} nome="enviar" tam=${36} />Solte para adicionar<span>${rotuloTipos(f)}</span>
    </div></div>`}

    ${senhaPara && html`<${DialogoSenha} arquivo=${senhaPara} aoFechar=${() => setSenhaPara(null)} />`}
  </div>`;
}

/* ---------------- senha de PDF protegido ---------------- */

function DialogoSenha({ arquivo, aoFechar }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = useRef(null);
  useEffect(() => { campo.current && campo.current.focus(); }, []);

  const confirmar = async (e) => {
    e.preventDefault();
    if (!senha) return;
    setOcupado(true);
    setErro(null);
    try {
      const d = await api.post(`/arquivos/${arquivo.id}/senha`, { senha });
      mudar((s) => { s.arquivos[d.arquivo.id] = d.arquivo; });
      avisar('Arquivo desbloqueado.', 'ok');
      aoFechar();
    } catch (err) {
      setErro(err.message);
      setOcupado(false);
    }
  };

  return html`<${Dialogo} titulo="Este PDF tem senha" aoFechar=${aoFechar}
    icone=${html`<span class="ic-acao"><${Icone} nome="cadeado" tam=${16} /></span>`}>
    <form onSubmit=${confirmar}>
      <div class="dialogo-corpo">
        <p style="color:var(--texto-2)">Digite a senha de <strong>${arquivo.nome}</strong>. Ela só é usada aqui, para abrir o arquivo.</p>
        <div class="campo">
          <input ref=${campo} class="entrada" type="password" value=${senha} placeholder="Senha" autocomplete="off"
            onInput=${(e) => setSenha(e.currentTarget.value)} />
          ${erro && html`<span class="ajuda" style="color:var(--erro)">${erro}</span>`}
        </div>
      </div>
      <div class="dialogo-rodape">
        <button type="button" class="btn" onClick=${aoFechar}>Cancelar</button>
        <button type="submit" class="btn btn-primario" disabled=${!senha || ocupado}>${ocupado ? html`<${Anel} tam="p" />` : ''} Abrir</button>
      </div>
    </form>
  <//>`;
}
