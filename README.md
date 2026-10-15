# XdPDF

Todas as ferramentas de PDF do dia a dia — juntar, dividir, comprimir, converter,
OCR, assinar, tarjar — num aplicativo que roda **no próprio computador**.
Nenhum arquivo é enviado para a internet.

## Abrir

1. Dê dois cliques em **`XdPDF.bat`**.
   Na primeira vez ele instala os componentes (um ou dois minutos) e cria o
   atalho **XdPDF** na área de trabalho e no menu Iniciar.
2. Depois disso, abra pelo atalho. O XdPDF abre numa **janela própria**, sem
   barra de endereço e sem janela preta.
3. Fechou a janela, o XdPDF encerra sozinho.

Se o atalho sumir, rode `scripts\criar-atalho.ps1` (botão direito → Executar
com o PowerShell).

### Requisitos

| O quê | Para quê |
|---|---|
| Windows 10 ou 11 | — |
| [Node.js](https://nodejs.org) LTS (20 ou mais novo) | obrigatório |
| Microsoft Edge ou Google Chrome | a janela do app e o "Site para PDF" (o Edge já vem no Windows) |
| Microsoft Office **ou** LibreOffice | só para Word/Excel/PowerPoint → PDF |
| Ghostscript | opcional: compressão extra e PDF/A mais rigoroso |

A tela **Configurações** mostra o que foi encontrado nesta máquina. Ferramentas
que dependem de algo que falta aparecem marcadas como indisponíveis, em vez de
falhar depois.

## Ferramentas

**Organizar** — Juntar (com marcadores por documento e opção de frente e verso),
Dividir (por intervalos, a cada N páginas, página por página ou **por tamanho
máximo**, para limites de envio como o do PJe), Remover páginas, Extrair
páginas, Organizar (arrastar, girar, duplicar, apagar, páginas em branco,
misturando arquivos) e Girar.

**Otimizar** — Comprimir (recomprime só as imagens: o texto continua
selecionável), OCR em português e inglês (o PDF continua idêntico e passa a ser
pesquisável) e Reparar.

**Converter para PDF** — Imagens (JPG, PNG, TIFF de várias páginas, WebP, GIF,
BMP; fotos de celular já saem na posição certa), Word, Excel, PowerPoint e
páginas da internet.

**Converter de PDF** — JPG/PNG (páginas inteiras ou só as imagens de dentro),
Word (parágrafos, títulos, negrito e tabelas), Excel (colunas reconstruídas;
`R$ 1.234,56` vira número e `01/02/2025` vira data, mas número de processo
continua texto), PowerPoint, texto e PDF/A.

**Editar** — Editar (texto, imagem, caixa, destaque, cobrir com branco),
Assinar (desenhar, digitar em letra cursiva ou usar a foto da assinatura no
papel; guardar para reutilizar; rubricar todas as páginas), Numerar (inclusive
`Fls. 12` e pulando a capa), Marca d'água (texto ou imagem, mosaico, por cima ou
por baixo), Recortar, Propriedades (ou apagar todos os metadados) e Achatar
formulários e anotações.

**Segurança** — Proteger com senha (AES-256), Desbloquear, **Tarjar**
(encontra CPF, CNPJ, RG, e-mail, telefone, CEP e termos; o conteúdo embaixo da
tarja é apagado de verdade, não só coberto) e Comparar duas versões, com o que
mudou palavra por palavra e um relatório em PDF.

Ao terminar, dá para baixar (vários arquivos saem num ZIP), **salvar direto numa
pasta**, abrir no programa padrão ou **continuar com outra ferramenta** sem
baixar e enviar de novo.

## Privacidade

- Tudo é processado aqui. O único acesso à internet é o do "Site para PDF",
  para carregar a página pedida.
- Os arquivos enviados ficam em `dados/entrada` e são apagados em até 12 horas
  (e sempre que o XdPDF reinicia). Os resultados ficam em `dados/saida` por
  7 dias e aparecem em **Arquivos recentes**.
- Por padrão o XdPDF só aceita conexões do próprio computador.

## Usar pelo celular ou por outros computadores

Inicie com a rede liberada:

```bat
set HOST=0.0.0.0
npm start
```

e abra `http://IP-DESTE-COMPUTADOR:3020` no celular (mesma rede Wi-Fi). A
interface foi feita para funcionar no celular: lista de ferramentas, botão de
ação fixo embaixo, arrastar segurando o dedo, "Tirar foto do documento" no
Imagem para PDF. Só libere a rede em redes de confiança: qualquer um nela
consegue usar o XdPDF.

## Atalhos

| Tecla | Ação |
|---|---|
| `Ctrl` + `K` | procurar ferramenta |
| `Ctrl` + `O` | adicionar arquivos |
| `Ctrl` + `Enter` | executar a ferramenta |
| `Esc` | fechar janelas |
| `Delete`, `Ctrl` + `D`, setas | no editor: apagar, duplicar e mover o item selecionado |

## O que foi corrigido em relação às ferramentas do MendesPDF

- **Liberar PDF gerava páginas em branco**, e numerar, marca d'água e assinar
  não apareciam em PDFs com restrição: o conteúdo era copiado ainda
  criptografado. Agora todo PDF travado é aberto e limpo na entrada.
- **Comprimir transformava as páginas em imagem**: o texto deixava de ser
  selecionável e PDFs de texto chegavam a aumentar. Agora só as imagens são
  recomprimidas e o arquivo nunca sai maior que o original.
- **OCR** substituía a página por um JPEG (perda de qualidade) e dependia do
  `worker.min.js` do tesseract.js, que não vem numa instalação nova da versão 7
  (um `npm install` limpo quebrava o OCR). Agora roda no servidor e só
  acrescenta a camada de texto invisível sobre a página original.
- **Assinar** não deixava escolher onde colocar a assinatura (posição fixa) e
  ignorava páginas giradas; numeração e marca d'água também.
- **Organizar** não reordenava pela tela (o seletor ordenava as páginas).
- Arquivos de uma ferramenta "vazavam" para a próxima, e as ferramentas de um
  arquivo só usavam o primeiro da lista sem avisar.
- **Baixar todos** disparava vários downloads (o navegador bloqueia); agora é um
  ZIP.
- Imagem para PDF com uma imagem só e "juntar" dava erro; fotos de celular
  saíam deitadas (EXIF).
- Office travado em diálogo podia deixar Word/Excel abertos para sempre; agora
  os processos que o XdPDF abriu são encerrados se algo travar.
- O servidor aceitava conexões de toda a rede, com navegação livre pelas pastas
  do computador.

## Desenvolvimento

```bash
npm install      # instala (e baixa os dados do OCR)
npm start        # servidor em http://127.0.0.1:3020 + navegador
npm run app      # como o atalho: janela própria, encerra ao fechar
npm test         # testa todas as ferramentas de ponta a ponta
npm run icones   # regenera os ícones a partir de public/icones/xdpdf.svg
npm run ocr      # baixa de novo os dados do OCR
```

Variáveis: `PORT` (padrão `3020`), `HOST` (padrão `127.0.0.1`), `ABRIR=0` para
não abrir janela, `XDPDF_DADOS` para mudar a pasta de dados.

```
src/
  server.js             servidor, janela do app e encerramento automático
  rotas/api.js          API (arquivos, ferramentas, tarefas, resultados)
  nucleo/               armazenamento, tarefas, eventos em tempo real, PDF
  motores/              Office, LibreOffice, imagens, pdf.js, OCR, compressão,
                        texto/tabelas, Word/Excel/PowerPoint, navegador
  ferramentas/          cada ferramenta, registrada no catálogo
public/                 interface (Preact + htm, sem etapa de build)
test/                   testes de ponta a ponta com PDFs gerados na hora
```

Num servidor Linux, instale LibreOffice e Chromium para as conversões de Office
e de sites; o resto funciona igual.

---

Desenvolvido por **Ihago Martins** — [@ihagomartins1](https://www.instagram.com/ihagomartins1/)
