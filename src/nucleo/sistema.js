'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const so = require('../motores/so');
const office = require('../motores/office');
const pdf = require('./pdf');

let cacheCapacidades = null;

/** O que esta máquina consegue fazer — a tela usa para avisar antes, não depois. */
async function capacidades() {
  if (cacheCapacidades) return cacheCapacidades;
  const apps = await office.detectar();
  const temIdioma = (lang) => fs.existsSync(path.join(config.vendor.tessdata, `${lang}.traineddata.gz`));
  cacheCapacidades = {
    plataforma: so.EH_WINDOWS ? 'windows' : process.platform,
    office: { word: apps.word, excel: apps.excel, powerpoint: apps.powerpoint },
    libreoffice: apps.libre,
    navegador: Boolean(so.acharNavegador()),
    ghostscript: Boolean(so.acharGhostscript()),
    ocr: { por: temIdioma('por'), eng: temIdioma('eng') },
  };
  return cacheCapacidades;
}

function textoData(d) {
  if (!d) return null;
  try { return d.toISOString(); } catch (_) { return null; }
}

/** Propriedades do PDF (título, autor...). */
async function infoPdf(caminho) {
  const doc = await pdf.abrir(caminho);
  const ler = (fn) => { try { return fn() || ''; } catch (_) { return ''; } };
  return {
    titulo: ler(() => doc.getTitle()),
    autor: ler(() => doc.getAuthor()),
    assunto: ler(() => doc.getSubject()),
    palavrasChave: ler(() => doc.getKeywords()),
    criador: ler(() => doc.getCreator()),
    produtor: ler(() => doc.getProducer()),
    criadoEm: textoData(ler(() => doc.getCreationDate())),
    modificadoEm: textoData(ler(() => doc.getModificationDate())),
    paginas: doc.getPageCount(),
    versao: (() => { try { const h = doc.context.header; return `${h.major}.${h.minor}`; } catch (_) { return ''; } })(),
    tamanho: fs.statSync(caminho).size,
  };
}

module.exports = { capacidades, infoPdf };
