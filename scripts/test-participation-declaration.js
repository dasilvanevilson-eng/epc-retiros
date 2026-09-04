const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const reportSource = app.match(/const participationDeclarationTypes = ([\s\S]*?)\nconst operationalReports = \[/)?.[0] || '';
const catalogSource = app.match(/const operationalReports = \[([\s\S]*?)\n\]\.map/)?.[1] || '';

assert(reportSource, 'As rotinas da Declaração de Participação devem existir.');
assert.match(catalogSource, /id: 'student-participation-declaration'[\s\S]*topic: 'Cursistas'[\s\S]*title: 'Declaração de Participação'/);
assert.match(catalogSource, /id: 'student-participation-declaration'[\s\S]*permissionsByFormType:[\s\S]*'cursista-individual': 'cursista\.ver'[\s\S]*'cursista-smp': 'cursista-smp\.ver'[\s\S]*'cursista-epc': 'cursista-epc\.ver'[\s\S]*direct: true/);
assert.match(app, /report\.id === 'student-participation-declaration'\) return openParticipationDeclarationReport\(\)/);
assert.match(catalogSource, /id: 'team-participation-declaration'[\s\S]*topic: 'Equipe de trabalho'[\s\S]*title: 'Declaração de Participação'[\s\S]*permission: 'pessoas\.ver'[\s\S]*direct: true/);
assert.match(app, /report\.id === 'team-participation-declaration'\) return openParticipationDeclarationReport\(\{ audience: 'team' \}\)/);

for (const type of ['Tachinha', 'Girassol', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui']) {
  assert(reportSource.includes(type), `Tipo de declaração ausente: ${type}`);
}
assert.match(reportSource, /available: type === 'Girassol'/, 'Somente o modelo Girassol deve estar disponível inicialmente.');
assert.match(reportSource, /Girassol: \{ available: true, buildDocument: girassolParticipationDeclarationDocument \}/);
for (const type of ['Tachinha', 'Taschinha', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP']) {
  assert.match(reportSource, new RegExp(`${type}: \\{ available: false \\}`));
}
assert.match(reportSource, /'Eis-me aqui': \{ available: false \}/);
assert.match(reportSource, /'EIS-ME AQUI': \{ available: false \}/);
assert.match(reportSource, /retreat\.tipoRetiro[\s\S]*suggestedType/, 'O tipo do retiro em foco deve ser sugerido no seletor.');
assert.match(reportSource, /modelo ainda não definido/, 'Modelos futuros devem permanecer visíveis com aviso.');

assert.match(reportSource, /dataService\.listCursistas\(retreat\.id\)/, 'Cursistas individuais devem ser filtrados no banco pelo retiro em foco.');
assert.match(reportSource, /coupleStudentSource\(studentFormType\)\.list\(retreat\.id\)/, 'Fichas de casal devem ser consultadas apenas no retiro em foco.');
assert.match(reportSource, /\['Dele', 'Dela'\]/, 'Cada integrante da ficha de casal deve virar uma opção individual.');
assert.match(reportSource, /enrolments[\s\S]*entry\.retiroId === retreat\.id/, 'A equipe deve ser isolada pelo retiro em foco.');
assert.match(reportSource, /entry\.dadosPessoais \|\| \{\}/, 'A declaração da equipe deve respeitar os dados históricos da adesão.');
assert.match(reportSource, /entry\.nome \|\| historical\.nome \|\| person\.nome/, 'Nome histórico da adesão deve ter prioridade.');
assert.match(reportSource, /historical\.cpf \|\| person\.cpf \|\| entry\.pessoaId/, 'CPF histórico da adesão deve ter prioridade.');
assert.doesNotMatch(reportSource, /usedCouples|groups\.push/, 'Integrantes de casal não podem ser agrupados na busca da declaração.');
assert.match(reportSource, /Digite nome, CPF ou número da ficha/);
assert.match(reportSource, /Digite nome, CPF ou setor/);
assert.match(reportSource, /Buscar equipe de trabalho/);
assert.match(reportSource, /normalizeText\(query\)/, 'A busca deve ignorar diferenças de acentuação e caixa.');
assert.match(reportSource, /normalizeCpf\(query\)/, 'A busca deve aceitar CPF formatado ou somente números.');
assert.match(reportSource, /participant\.fileNumber/, 'A busca e o resumo devem incluir o número da ficha.');

assert.match(reportSource, /não possui nome cadastrado/);
assert.match(reportSource, /não possui CPF cadastrado/);
assert.match(reportSource, /datas inicial e final do retiro precisam estar preenchidas/);
assert.match(reportSource, /data final do retiro não pode ser anterior/);
assert.match(reportSource, /A janela de impressão foi bloqueada/);

for (const text of [
  'DECLARAÇÃO DE PARTICIPAÇÃO',
  'EVANGELIZAÇÃO DE CRIANÇAS DE 07 A 10 ANOS',
  'Das 8h às 18:30h',
  'R. Mal. Floriano Peixoto, 362 - Centro, Indaial - SC',
  'EVANDRO BIEGER/ LUCIANA A. N. BIEGER',
  '47 - 988328012',
  '52.109.946/0001-94',
]) assert(reportSource.includes(text), `Texto obrigatório ausente no modelo: ${text}`);
assert.match(reportSource, /const participationRole = audience === 'team' \? 'voluntário\(a\)' : 'cursista'/);
assert.match(reportSource, /onde participou como \$\{participationRole\} na seguinte atividade:/);
for (const asset of ['assets/girassol.png', 'assets/epc.png', 'assets/paroquia-santa-ines.svg']) {
  assert(reportSource.includes(asset), `Marca ausente no documento: ${asset}`);
}
assert(fs.existsSync(path.join(root, 'assets', 'paroquia-santa-ines.svg')), 'A marca da Paróquia deve fazer parte do projeto.');
assert.match(reportSource, /@page\{size:A4 portrait;margin:0\}/);
assert.match(styles, /\.participation-declaration-dialog/);
assert.match(styles, /\.participation-declaration-results/);

const dateHelpers = app.match(/const participationDeclarationLongDate = [\s\S]*?\n};\n\nconst participationDeclarationPeriod = [\s\S]*?\n};/)?.[0] || '';
const context = {
  Intl,
  Date,
  normalizeDateInput(value = '') {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!iso) return '';
    const parsed = new Date(`${raw}T12:00:00`);
    return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(iso[1]) && parsed.getMonth() + 1 === Number(iso[2]) && parsed.getDate() === Number(iso[3]) ? raw : '';
  },
};
vm.runInNewContext(`${dateHelpers}\nresult = { sameDay: participationDeclarationPeriod('2026-05-10', '2026-05-10'), sameMonth: participationDeclarationPeriod('2026-05-10', '2026-05-12'), crossMonth: participationDeclarationPeriod('2026-05-31', '2026-06-01') };`, context);
assert.equal(context.result.sameDay, 'no dia 10 de maio de 2026');
assert.equal(context.result.sameMonth, 'nos dias 10 e 12 de maio de 2026');
assert.equal(context.result.crossMonth, 'no período de 31 de maio de 2026 a 1 de junho de 2026');

for (const forbidden of ['saveCursista', 'deleteCursista', 'saveAdesao', 'deleteAdesao']) {
  assert(!reportSource.includes(forbidden), `O relatório não pode executar ${forbidden}.`);
}

console.log('Declarações de Participação: cursistas, equipe, casais individuais, impressão A4 e proteção dos dados validados.');
