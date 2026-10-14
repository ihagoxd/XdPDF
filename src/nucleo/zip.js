'use strict';

/**
 * ZIP em fluxo: os arquivos vão direto do disco para a resposta, sem montar
 * tudo na memória (um lote de imagens pode passar de centenas de MB).
 */

const fs = require('fs');
const { Zip, ZipPassThrough, ZipDeflate } = require('fflate');

const JA_COMPRIMIDOS = /\.(pdf|jpe?g|png|zip|docx|xlsx|pptx|gif|webp)$/i;

/**
 * @param {import('stream').Writable} destino
 * @param {{nome:string, caminho:string}[]} itens nomes já únicos
 */
function escreverZip(destino, itens) {
  return new Promise((resolve, reject) => {
    const zip = new Zip((err, dados, fim) => {
      if (err) { reject(err); return; }
      destino.write(Buffer.from(dados));
      if (fim) resolve();
    });

    (async () => {
      for (const item of itens) {
        // PDF, JPG e Office já vêm comprimidos: guardar sem recomprimir é muito mais rápido.
        const entrada = JA_COMPRIMIDOS.test(item.nome)
          ? new ZipPassThrough(item.nome)
          : new ZipDeflate(item.nome, { level: 6 });
        entrada.mtime = new Date();
        zip.add(entrada);
        await new Promise((ok, falha) => {
          const leitor = fs.createReadStream(item.caminho, { highWaterMark: 1 << 20 });
          leitor.on('data', (pedaco) => entrada.push(new Uint8Array(pedaco.buffer, pedaco.byteOffset, pedaco.length)));
          leitor.on('end', () => { entrada.push(new Uint8Array(0), true); ok(); });
          leitor.on('error', falha);
        });
      }
      zip.end();
    })().catch(reject);
  });
}

module.exports = { escreverZip };
