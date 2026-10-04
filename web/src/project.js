// Arquivo de projeto do RC32S3: um único .json com o PAR de programas
// (Controle + Carrinho). Salvar e abrir sempre trata os dois juntos.
//
// {
//   "formato": "rc32s3",
//   "versao": 2,
//   "nome": "meu-carrinho",
//   "salvoEm": "2026-10-04T13:00:00.000Z",
//   "controle": { ...blocos do Blockly... },
//   "carrinho": { ...blocos do Blockly... }
// }

export const FORMAT = 'rc32s3';
export const VERSION = 2;
export const EXTENSION = '.rc32s3.json';
const LEGACY_FORMATS = ['blockly-rc'];

export function serializeProject({ nome, controle, carrinho }) {
  return JSON.stringify(
    {
      formato: FORMAT,
      versao: VERSION,
      nome: nome || 'meu-projeto',
      salvoEm: new Date().toISOString(),
      controle,
      carrinho,
    },
    null,
    2,
  );
}

// Lê e valida o texto de um arquivo. Erros têm mensagem para o usuário.
export function parseProject(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Este arquivo não é um projeto do RC32S3 (não é um JSON válido).');
  }
  if (!data || typeof data !== 'object' || (data.formato !== FORMAT && !LEGACY_FORMATS.includes(data.formato))) {
    throw new Error('Este arquivo não é um projeto do RC32S3.');
  }
  if (data.versao > VERSION) {
    throw new Error('Este projeto foi feito numa versão mais nova do RC32S3. Atualize a página.');
  }
  const missing = ['controle', 'carrinho'].filter((k) => !data[k] || typeof data[k] !== 'object');
  if (missing.length) {
    throw new Error(`Projeto incompleto: falta o programa do ${missing.join(' e do ')}. O projeto precisa ter os dois.`);
  }
  return { nome: typeof data.nome === 'string' && data.nome ? data.nome : null, controle: data.controle, carrinho: data.carrinho };
}

// Nome de arquivo seguro: "Meu Carrinho!" -> "meu-carrinho"
export function fileSlug(name) {
  return (
    String(name || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'meu-projeto'
  );
}

export function nameFromFile(filename) {
  return filename.replace(/\.rc32s3\.json$|\.rc\.json$|\.json$/i, '');
}
