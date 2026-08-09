const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('adminApp.js');
const api = read('apiCore.js');
const client = read('dataService.js');
const adapter = read('databaseAdapter.js');
const stores = read('storeConfig.js');
const styles = read('styles.css');
const migration = read('supabase-remover-construtor-relatorios.sql');
const reportRenderSource = app.match(/async function renderRelatorios\(\) \{([\s\S]*?)\n\}\n\nasync function renderBackup/)?.[1] || '';

const catalogSource = app.match(/const operationalReports = \[([\s\S]*?)\n\]\.map/)?.[1] || '';
assert(catalogSource, 'A Central deve possuir um catalogo compartilhado.');
const topics = [...catalogSource.matchAll(/topic: '([^']+)'/g)].map((match) => match[1]);
assert.deepStrictEqual([...new Set(topics)].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })), ['Comunidades', 'Crachás', 'Cursistas', 'Equipe de trabalho', 'Espaço Kids', 'Geral', 'Quadrante']);

for (const title of [
  'Camisetas dos cursistas por comunidade', 'Número das camisetas por comunidade — formato ampliado',
  'Crachás por comunidade', 'Crachás por setor', 'Alergias a medicamentos', 'Aniversariantes dos cursistas',
  'Camisetas por casal', 'Camisetas por tamanho', 'Intolerâncias alimentares', 'Medicação contínua',
  'Medicação sugerida pelos pais', 'Necessidade de acolhimento', 'Problemas de saúde', 'Imprimir fichas completas',
  'Declaração de Participação',
  'Aniversariantes da equipe', 'Fotos solicitadas', 'Pessoas por grupo', 'Pessoas por setor',
  'Solicitações de quadrante impresso', 'Crianças cadastradas', 'Crianças com intolerância alimentar',
  'Crianças com problema de saúde',
  'Cidades participantes', 'Presença por dia', 'Relatório completo', 'Relatório para amigo secreto',
]) assert(catalogSource.includes(`title: '${title}'`), `Relatorio ausente: ${title}`);
assert(!catalogSource.includes("title: 'Planilha do Recebedor'"), 'A Planilha do Recebedor nao deve aparecer na Central.');
assert(!catalogSource.includes("topic: 'Financeiro'"), 'O topico Financeiro nao deve aparecer na Central.');
for (const title of ['Resumo financeiro dos Cursistas EPC', 'Resumo financeiro dos Cursistas Individuais', 'Resumo financeiro dos Cursistas SMP']) {
  assert(!catalogSource.includes(`title: '${title}'`), `O relatorio financeiro nao deve aparecer na Central: ${title}`);
}
assert.match(app, /id="student-financial-summary"/, 'O botao financeiro do Cursista Individual deve permanecer na origem.');
assert.match(app, /id="smp-financial-summary"/, 'O botao financeiro compartilhado por SMP e EPC deve permanecer na origem.');
assert.match(app, /wireFinancialSummaryButton\(\{\s*buttonSelector: '#student-financial-summary'/, 'O gerador financeiro Individual deve permanecer conectado.');
assert.match(app, /wireFinancialSummaryButton\(\{\s*buttonSelector: '#smp-financial-summary'/, 'O gerador financeiro SMP e EPC deve permanecer conectado.');

assert.match(app, /new Intl\.Collator\('pt-BR'/);
assert.match(app, /compare\(first\.topic, second\.topic\).*compare\(first\.title, second\.title\)/);
assert.match(app, /aria-expanded', 'false'/);
assert.match(app, /aria-controls/);
assert.match(app, /Ver descrição/);
assert.match(app, /Ocultar descrição/);
assert(reportRenderSource, 'A rotina de renderizacao da Central deve existir.');
assert.match(reportRenderSource, /const retreat = selectedRetreat\(\)/, 'A Central deve usar o retiro em foco.');
assert.doesNotMatch(reportRenderSource, /accessibleRetreats\(\)|setSelectedRetreatId\(|report-center-retreat-select/, 'A Central nao deve listar nem trocar retiros.');
assert.doesNotMatch(styles, /report-center-retreat/, 'Os estilos do seletor interno devem ser removidos.');
assert.match(reportRenderSource, /Retiro em foco:/, 'A Central deve identificar o retiro em foco no cabecalho.');
assert.match(reportRenderSource, /Nenhum retiro está em foco[\s\S]*href: '#inicio'/, 'Sem foco, a Central deve orientar o usuario a voltar ao Inicio.');
assert.match(catalogSource, /formTypes: \['cursista-individual'\]/, 'O catalogo deve filtrar relatorios de Cursista Individual.');
assert.match(catalogSource, /formTypes: \['cursista-smp', 'cursista-epc'\]/, 'O catalogo deve filtrar relatorios compartilhados de SMP e EPC.');
assert.match(app, /const permission = report\.permissionsByFormType\?\.\[formType\] \|\| report\.permission;[\s\S]*return canAccess\(permission\)/, 'Cada relatório deve validar sua permissão efetiva.');
assert.match(app, /report\.formTypes\.includes/);
assert.match(catalogSource, /id: 'student-complete-sheets'[\s\S]*permissionsByFormType:[\s\S]*'cursista-individual': 'cursista\.ver'[\s\S]*'cursista-smp': 'cursista-smp\.ver'[\s\S]*'cursista-epc': 'cursista-epc\.ver'/, 'A impressao completa deve respeitar a permissao da modalidade em foco.');
assert.match(app, /Ficha inicial[\s\S]*Ficha final[\s\S]*Imprimir todas/, 'O relatorio deve oferecer intervalo de fichas e impressao integral.');
assert.match(app, /fileNumber >= initial && fileNumber <= final/, 'O intervalo de fichas deve ser inclusivo.');
assert.match(app, /generate: \(\) => runOperationalReportGenerator\(report\)/, 'Cada item deve registrar sua funcao geradora.');
assert.match(app, /control\.click\(\)/, 'A funcao geradora deve executar o controle original do relatorio.');
assert.match(app, /scrollY: window\.scrollY/, 'A Central deve guardar a posicao de rolagem antes de abrir o relatorio.');
assert.match(app, /watchOperationalReportClose\(\)/, 'O fechamento do relatorio deve ser monitorado.');
assert.match(app, /location\.hash = '#relatorios'/, 'Ao fechar, o fluxo deve retornar para a Central.');
assert.match(app, /window\.scrollTo\(\{ top: state\.scrollY/, 'A posicao anterior da Central deve ser restaurada.');
assert.match(app, /launch\?\.focus\(\{ preventScroll: true \}\)/, 'O foco deve voltar ao relatorio executado.');
assert.match(styles, /\.report-center-grid/);
assert.match(styles, /@media\(max-width:650px\).*\.report-center-grid/s);

for (const source of [api, client, adapter, stores]) assert.doesNotMatch(source, /relatorio_modelos|reportService|\/reports\/(?:catalog|preview|export|models)/);
assert(!fs.existsSync(path.join(root, 'reportService.js')), 'O servico do construtor antigo deve ser removido.');
assert.match(migration, /select count\(\*\) from public\.relatorio_modelos/i);
assert.match(migration, /if v_total <> 0/i);
assert.match(migration, /backup_checksum/i);
assert.match(migration, /drop table public\.relatorio_modelos/i);

console.log('Central de Relatorios: catalogo, filtros, acessibilidade, reutilizacao e remocao do construtor validados.');
