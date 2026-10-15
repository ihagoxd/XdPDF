'use strict';

/**
 * Word, Excel e PowerPoint -> PDF.
 *
 * No Windows usa o próprio Office instalado (automação COM): o resultado é
 * idêntico ao "Salvar como PDF" do programa. O lote inteiro é convertido numa
 * única sessão de cada programa, porque abrir o Word custa uns 2 s e cada
 * arquivo custa décimos. Sem Office (ou fora do Windows), usa o LibreOffice.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const config = require('../config');
const so = require('./so');
const libre = require('./libre');

const execFileAsync = promisify(execFile);

const DIR_CACHE = path.join(config.pastas.trabalho, 'office');

const EXT_WORD = new Set(['.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt', '.txt']);
const EXT_EXCEL = new Set(['.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.csv']);
const EXT_PPT = new Set(['.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp']);

const NOMES = { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' };

function programaDe(nome) {
  const ext = path.extname(nome).toLowerCase();
  if (EXT_WORD.has(ext)) return 'word';
  if (EXT_EXCEL.has(ext)) return 'excel';
  if (EXT_PPT.has(ext)) return 'powerpoint';
  return null;
}

/* ---------------- detecção ---------------- */

let deteccao = null;

const PS_DETECTAR = `
$r = @{ word = $false; excel = $false; powerpoint = $false }
foreach ($p in 'Word','Excel','PowerPoint') {
  try { if ([Type]::GetTypeFromProgID("$p.Application")) { $r[$p.ToLower()] = $true } } catch {}
}
$r | ConvertTo-Json -Compress
`;

/** O programa está registrado para automação? (consulta ao registro: milissegundos) */
function registrado(progId) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCR\\' + progId + '\\CLSID', '/ve'], { windowsHide: true, timeout: 8000 }, (err) => resolve(!err));
  });
}

/** Quais programas existem: { word, excel, powerpoint, libre } */
function detectar() {
  if (deteccao) return deteccao;
  deteccao = (async () => {
    const temLibre = Boolean(so.acharLibreOffice());
    if (!so.EH_WINDOWS) return { word: false, excel: false, powerpoint: false, libre: temLibre };
    try {
      const [word, excel, powerpoint] = await Promise.all(['Word.Application', 'Excel.Application', 'PowerPoint.Application'].map(registrado));
      return { word, excel, powerpoint, libre: temLibre };
    } catch (_) { /* tenta pelo PowerShell */ }
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_DETECTAR],
        { windowsHide: true, encoding: 'utf8', timeout: 25000 }
      );
      const r = JSON.parse(stdout.trim());
      return { word: !!r.word, excel: !!r.excel, powerpoint: !!r.powerpoint, libre: temLibre };
    } catch (_) {
      return { word: false, excel: false, powerpoint: false, libre: temLibre };
    }
  })();
  return deteccao;
}

/* ---------------- script de conversão em lote ---------------- */

const PS_CONVERTER = String.raw`
param([string]$ListaJson)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$itens = Get-Content -LiteralPath $ListaJson -Raw -Encoding UTF8 | ConvertFrom-Json
$saida = New-Object System.Collections.ArrayList
$word = $null; $excel = $null; $ppt = $null

# Quem já estava aberto antes: no fim só encerramos o que nós mesmos abrimos.
$antes = @{}
foreach ($nome in 'WINWORD','EXCEL','POWERPNT') {
  $antes[$nome] = @(Get-Process -Name $nome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Encerrar-Orfaos {
  $ErrorActionPreference = 'Continue'
  foreach ($nome in 'WINWORD','EXCEL','POWERPNT') {
    foreach ($proc in @(Get-Process -Name $nome -ErrorAction SilentlyContinue)) {
      if ($antes[$nome] -notcontains $proc.Id) {
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }
}

function Fechar-Tudo {
  $ErrorActionPreference = 'Continue'
  if ($null -ne $script:word)  { try { $script:word.Quit(0) } catch {} }
  if ($null -ne $script:excel) { try { $script:excel.Quit() } catch {} }
  if ($null -ne $script:ppt)   { try { $script:ppt.Quit() }   catch {} }
  foreach ($app in @($script:word, $script:excel, $script:ppt)) {
    if ($null -eq $app) { continue }
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch {}
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}

try {
  foreach ($it in $itens) {
    $res = @{ origem = $it.origem; destino = $it.destino; ok = $false; erro = $null }
    try {
      switch ($it.programa) {
        'word' {
          if (-not $word) {
            $word = New-Object -ComObject Word.Application
            $word.Visible = $false
            $word.DisplayAlerts = 0
            $word.Options.SavePropertiesPrompt = $false
            $word.Options.ConfirmConversions = $false
            $word.Options.UpdateLinksAtOpen = $false
          }
          # senha falsa: um arquivo protegido falha na hora em vez de travar pedindo senha
          $doc = $word.Documents.Open($it.origem, $false, $true, $false, "###", "###", $true,
                                      "###", "###", 0, [System.Type]::Missing, $false, $true)
          try {
            # 17 = PDF; CreateBookmarks 1 = marcadores a partir dos títulos
            $doc.ExportAsFixedFormat($it.destino, 17, $false, 0, 0, 0, 0, 0, $true, $true, 1, $true, $true, $false)
          } finally { $doc.Close(0) | Out-Null }
        }
        'excel' {
          if (-not $excel) {
            $excel = New-Object -ComObject Excel.Application
            $excel.Visible = $false
            $excel.DisplayAlerts = $false
            $excel.AskToUpdateLinks = $false
            $excel.EnableEvents = $false
          }
          $wb = $excel.Workbooks.Open($it.origem, 0, $true, [System.Type]::Missing, "###", "###", $true)
          try { $wb.ExportAsFixedFormat(0, $it.destino) }
          finally { $wb.Close($false) | Out-Null }
        }
        'powerpoint' {
          if (-not $ppt) {
            $ppt = New-Object -ComObject PowerPoint.Application
            $ppt.DisplayAlerts = 1
          }
          $pres = $ppt.Presentations.Open($it.origem, $true, $false, $false)
          try { $pres.SaveAs($it.destino, 32) }
          finally { $pres.Close() | Out-Null }
        }
      }
      if (Test-Path -LiteralPath $it.destino) { $res.ok = $true }
      else { $res.erro = 'O Office não gerou o PDF' }
    } catch {
      $res.erro = $_.Exception.Message
    }
    [void]$saida.Add($res)
  }
} finally {
  Fechar-Tudo
  Start-Sleep -Milliseconds 300
  Encerrar-Orfaos
}

ConvertTo-Json -InputObject @($saida) -Compress -Depth 4
`;

function garantirScript() {
  fs.mkdirSync(DIR_CACHE, { recursive: true });
  const alvo = path.join(DIR_CACHE, '_converter.ps1');
  if (!fs.existsSync(alvo)) fs.writeFileSync(alvo, '﻿' + PS_CONVERTER, 'utf8');
  return alvo;
}

/** Nome estável do PDF convertido: o mesmo arquivo vira o mesmo PDF em cache. */
async function caminhoCache(origem) {
  let st = { size: 0, mtimeMs: 0 };
  try { st = await fsp.stat(origem); } catch (_) { /* segue */ }
  const chave = crypto.createHash('sha1')
    .update(`${path.resolve(origem)}|${st.size}|${Math.round(st.mtimeMs)}`)
    .digest('hex');
  return path.join(DIR_CACHE, `${chave}.pdf`);
}

/** PIDs do Office abertos agora — para fechar só o que nós abrimos se algo travar. */
async function pidsOffice() {
  if (!so.EH_WINDOWS) return new Set();
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    const pids = new Set();
    for (const linha of stdout.split(/\r?\n/)) {
      const m = linha.match(/^"(WINWORD|EXCEL|POWERPNT)\.EXE","(\d+)"/i);
      if (m) pids.add(Number(m[2]));
    }
    return pids;
  } catch (_) {
    return new Set();
  }
}

async function encerrarNovos(antes) {
  const agora = await pidsOffice();
  for (const pid of agora) {
    if (!antes.has(pid)) {
      try { process.kill(pid); } catch (_) { /* já saiu */ }
    }
  }
}

/* Uma conversão por vez: duas sessões COM do Word brigam entre si. */
let fila = Promise.resolve();

/**
 * Converte vários arquivos do Office em PDF.
 * @param {string[]} origens
 * @returns {Promise<Map<string, {ok:boolean, pdf?:string, erro?:string}>>} chave = caminho absoluto
 */
function converter(origens) {
  const tarefa = fila.then(() => converterAgora(origens));
  fila = tarefa.catch(() => {});
  return tarefa;
}

async function converterAgora(origens) {
  const resultado = new Map();
  if (!origens.length) return resultado;
  fs.mkdirSync(DIR_CACHE, { recursive: true });

  const apps = await detectar();
  const pendentesCom = [];
  const pendentesLibre = [];

  for (const bruto of origens) {
    const origem = path.resolve(bruto);
    const programa = programaDe(origem);
    if (!programa) {
      resultado.set(origem, { ok: false, erro: 'Formato não suportado' });
      continue;
    }
    const destino = await caminhoCache(origem);
    if (fs.existsSync(destino) && fs.statSync(destino).size > 0) {
      resultado.set(origem, { ok: true, pdf: destino });
      continue;
    }
    if (so.EH_WINDOWS && apps[programa]) pendentesCom.push({ origem, destino, programa });
    else if (apps.libre) pendentesLibre.push({ origem, destino });
    else resultado.set(origem, { ok: false, erro: `${NOMES[programa]} não está instalado nesta máquina` });
  }

  if (pendentesCom.length) await converterComOffice(pendentesCom, resultado);
  if (pendentesLibre.length) await converterComLibre(pendentesLibre, resultado);
  return resultado;
}

async function converterComOffice(pendentes, resultado) {
  const lista = path.join(DIR_CACHE, `lote-${crypto.randomBytes(5).toString('hex')}.json`);
  const antes = await pidsOffice();
  try {
    await fsp.writeFile(lista, JSON.stringify(pendentes), 'utf8');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', garantirScript(), '-ListaJson', lista],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: Math.max(120000, pendentes.length * 60000) }
    );
    let saida = [];
    try { saida = JSON.parse((stdout || '').trim() || '[]'); } catch (_) { saida = []; }
    if (!Array.isArray(saida)) saida = [saida];
    for (const r of saida) {
      if (!r || !r.origem) continue;
      resultado.set(path.resolve(r.origem), r.ok
        ? { ok: true, pdf: r.destino }
        : { ok: false, erro: limparErroOffice(r.erro) });
    }
  } catch (err) {
    await encerrarNovos(antes);
    const msg = err.killed ? 'O Office demorou demais e a conversão foi interrompida' : `Falha ao acionar o Office (${err.code || err.message})`;
    for (const p of pendentes) if (!resultado.has(p.origem)) resultado.set(p.origem, { ok: false, erro: msg });
  } finally {
    fsp.rm(lista, { force: true }).catch(() => {});
  }
  for (const p of pendentes) {
    if (!resultado.has(p.origem)) resultado.set(p.origem, { ok: false, erro: 'Conversão interrompida' });
  }
}

function limparErroOffice(msg) {
  const texto = String(msg || 'Falha na conversão').split('\n')[0];
  if (/senha|password/i.test(texto)) return 'O arquivo tem senha. Abra no Office, tire a senha e tente de novo.';
  if (/corrupt|danificad|corrompid/i.test(texto)) return 'O arquivo está danificado e o Office não conseguiu abrir.';
  return texto.slice(0, 180);
}

async function converterComLibre(pendentes, resultado) {
  const { resultado: saidas, destino: pasta } = await libre.paraPdf(pendentes.map((p) => p.origem));
  for (const p of pendentes) {
    const r = saidas.get(p.origem);
    if (r && r.ok) {
      try {
        await fsp.copyFile(r.saida, p.destino);
        resultado.set(p.origem, { ok: true, pdf: p.destino });
      } catch (_) {
        resultado.set(p.origem, { ok: false, erro: 'Não deu para guardar o PDF convertido' });
      }
    } else {
      resultado.set(p.origem, { ok: false, erro: (r && r.erro) || 'Falha na conversão' });
    }
  }
  await libre.limpar(pasta);
}

module.exports = { programaDe, detectar, converter, NOMES };
