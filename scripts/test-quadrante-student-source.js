const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
const start = source.indexOf('async function renderQuadrante()');
const end = source.indexOf('\nfunction choices(', start);
assert(start >= 0 && end > start, 'Renderização do Quadrante não encontrada.');
const quadrante = source.slice(start, end);

assert.match(quadrante, /studentFormType = retreat\.tipoFichaCursista \|\| defaultStudentFormType/, 'O Quadrante deve respeitar a ficha configurada no retiro em foco.');
assert.match(quadrante, /activeCoupleStudentSource = usesCoupleStudents \? coupleStudentSource\(studentFormType\) : null/, 'EPC e SMP devem usar a fonte correspondente à ficha configurada.');
assert.match(quadrante, /memberField = usesCoupleStudents \? activeCoupleStudentSource\.memberField : 'membroIds'/, 'O campo de membros deve acompanhar a tabela de cursistas selecionada.');
assert.match(quadrante, /activeCoupleStudentSource\.list\(retreat\.id\) : dataService\.listCursistas\(retreat\.id\)/, 'Toda consulta de cursistas deve receber o retiro em foco.');
assert.match(quadrante, /students\.filter\(\(student\) => student\.retiroId === retreat\.id\)/, 'Os registros retornados devem ser novamente isolados pelo retiro em foco.');
assert.match(quadrante, /community\[memberField\]/, 'Comunidades devem ser lidas pelo campo de membros da ficha configurada.');
assert.doesNotMatch(quadrante, /community\.membroIds/, 'O Quadrante não pode fixar a leitura na tabela de cursistas individuais.');
assert.match(quadrante, /nome: student\.nomeDele, nascimento: student\.nascimentoDele, telefone: student\.foneDele/, 'Os dados dele devem formar uma linha própria no Quadrante.');
assert.match(quadrante, /nome: student\.nomeDela, nascimento: student\.nascimentoDela, telefone: student\.foneDela/, 'Os dados dela devem formar uma linha própria no Quadrante.');
assert.match(quadrante, /memberIds = new Set\(\(community\[memberField\] \|\| \[\]\)\.map\(String\)\)/, 'IDs de vínculo devem ser normalizados antes da comparação.');
assert.match(quadrante, /\[memberField\]: unassignedStudents\.map/, 'A seção sem comunidade deve manter o mesmo campo de vínculo da ficha configurada.');

console.log('Quadrante: fontes Individual, SMP e EPC isoladas pelo retiro em foco validadas.');
