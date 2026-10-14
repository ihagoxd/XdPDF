'use strict';

/**
 * Caminhos e opções do XdPDF. Tudo que depende do ambiente passa por aqui.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const argumentos = process.argv.slice(2);

const DIR_DADOS = process.env.XDPDF_DADOS
  ? path.resolve(process.env.XDPDF_DADOS)
  : path.join(RAIZ, 'dados');

const pastas = {
  dados: DIR_DADOS,
  entrada: path.join(DIR_DADOS, 'entrada'),     // arquivos enviados
  saida: path.join(DIR_DADOS, 'saida'),         // resultados prontos para baixar
  trabalho: path.join(DIR_DADOS, 'trabalho'),   // temporários de cada operação
  assinaturas: path.join(DIR_DADOS, 'assinaturas'),
  navegador: path.join(DIR_DADOS, 'janela'),    // perfil da janela do app
  cacheOcr: path.join(DIR_DADOS, 'cache-ocr'),
};

for (const dir of Object.values(pastas)) fs.mkdirSync(dir, { recursive: true });

function pastaDownloadsPadrao() {
  const casa = os.homedir();
  const candidatos = [path.join(casa, 'Downloads'), path.join(casa, 'Transferências'), casa];
  return candidatos.find((c) => fs.existsSync(c)) || casa;
}

module.exports = {
  RAIZ,
  VERSAO: require('../package.json').version,
  PORTA: Number(process.env.PORT) || 3020,
  // Só a própria máquina enxerga o app. Para servir na rede, HOST=0.0.0.0.
  HOST: process.env.HOST || '127.0.0.1',
  MODO_APP: argumentos.includes('--app') || process.env.XDPDF_APP === '1',
  ABRIR_JANELA: process.env.ABRIR !== '0',
  pastas,
  vendor: {
    pdfjs: path.join(RAIZ, 'node_modules', 'pdfjs-dist'),
    tessdata: path.join(RAIZ, 'vendor', 'tessdata'),
  },
  ARQUIVO_CONFIG: path.join(DIR_DADOS, 'config.json'),
  ARQUIVO_HISTORICO: path.join(DIR_DADOS, 'historico.json'),
  pastaDownloadsPadrao,
  // Limites de entrada
  LIMITE_ARQUIVO_MB: 500,
  LIMITE_ARQUIVOS: 400,
  // Quanto tempo os arquivos ficam guardados antes da faxina automática
  HORAS_ENTRADA: 12,
  DIAS_RESULTADO: 7,
};
