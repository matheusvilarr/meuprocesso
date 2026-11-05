// Gera o HTML do e-mail "novas intimações" com itens fictícios, usando o mesmo
// modelo que o sistema envia (montarEmailNovasDescobertas). Não envia nada.
// Uso (da raiz do repositório): node scripts/fotos-site/email.mjs saida.html
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.SUPABASE_SERVICE_KEY = 'dubla';
const { montarEmailNovasDescobertas } = await import(pathToFileURL(path.join(RAIZ, 'lib', 'djen-cadernos.js')).href);

// Banco de mentira: a busca da data de distribuição grava no banco — aqui vira nada.
const nada = () => { const p = new Proxy(function () {}, { get: (_, k) => k === 'then' ? (ok) => ok({ data: null, error: null }) : () => p }); return p; };
const admin = { from: () => nada() };
const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const itens = [
  { numero: '0716402-88.2026.8.07.0001', tribunal: 'TJDFT', classe: 'Procedimento Comum Cível', orgao: '5ª Vara Cível de Brasília',
    autor: 'Vinícius Andrade Lobo', reu: 'Seguradora Brasília Previdência', tipo: 'Intimação', dataPublicacao: hoje, link: 'https://comunicaapi.pje.jus.br/' },
  { numero: '0002215-41.2026.5.10.0007', tribunal: 'TRT10', classe: 'Ação Trabalhista - Rito Ordinário', orgao: '7ª Vara do Trabalho de Brasília',
    autor: 'Cíntia Mendes Carvalho', reu: 'Supermercados Planalto Ltda.', tipo: 'Intimação', dataPublicacao: hoje, link: 'https://comunicaapi.pje.jus.br/' },
];
const user = { user_metadata: { full_name: 'Helena Marques Prado' } };
const { html } = await montarEmailNovasDescobertas(admin, 'x', user, itens);
fs.writeFileSync(process.argv[2], html);
