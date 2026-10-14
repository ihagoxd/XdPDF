'use strict';

/**
 * Baixa (uma vez) os dados de idioma do OCR para vendor/tessdata.
 * Depois disso o reconhecimento de texto funciona sem internet.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DESTINO = path.join(__dirname, '..', 'vendor', 'tessdata');
const IDIOMAS = ['por', 'eng'];
const BASE = 'https://tessdata.projectnaptha.com/4.0.0';
const silencioso = process.argv.includes('--silencioso');

function log(...a) { if (!silencioso) console.log(...a); }

function baixar(url, alvo, redirecionamentos = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirecionamentos > 0) {
        res.resume();
        return resolve(baixar(new URL(res.headers.location, url).toString(), alvo, redirecionamentos - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const temporario = `${alvo}.parcial`;
      const arquivo = fs.createWriteStream(temporario);
      res.pipe(arquivo);
      arquivo.on('finish', () => arquivo.close(() => {
        fs.renameSync(temporario, alvo);
        resolve();
      }));
      arquivo.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  for (const lang of IDIOMAS) {
    const alvo = path.join(DESTINO, `${lang}.traineddata.gz`);
    if (fs.existsSync(alvo) && fs.statSync(alvo).size > 1000) {
      log(`  OCR ${lang}: já está aqui`);
      continue;
    }
    try {
      log(`  OCR ${lang}: baixando...`);
      await baixar(`${BASE}/${lang}.traineddata.gz`, alvo);
      log(`  OCR ${lang}: pronto`);
    } catch (err) {
      // Sem internet na instalação não pode travar o npm install: o OCR só fica
      // indisponível até rodar "npm run ocr" com conexão.
      console.warn(`  OCR ${lang}: não deu para baixar (${err.message}). Rode "npm run ocr" depois.`);
    }
  }
})();
