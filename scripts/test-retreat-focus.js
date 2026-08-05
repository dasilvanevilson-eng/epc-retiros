const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const section = (startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Seção não encontrada: ${startText}`);
  return source.slice(start, end);
};

const focusState = section('const selectedRetreatStorageKeyPrefix', 'const isRetreatConcluded');
assert.match(focusState, /currentUser\?\.id \|\| currentUser\?\.username/, 'A preferência deve ser separada por usuário.');
assert.match(focusState, /encodeURIComponent\(userKey\)/, 'A identidade do usuário deve formar uma chave local segura.');
assert.match(focusState, /localStorage\.setItem\(selectedRetreatStorageKey\(\), id\)/, 'O foco deve persistir no navegador atual.');
assert.match(focusState, /if \(fallback\) setSelectedRetreatId\(fallback\.id\)/, 'Foco inválido deve ser substituído pelo retiro permitido de fallback.');
assert.doesNotMatch(focusState, /getItem\(selectedRetreatStorageKeyPrefix\)/, 'A antiga preferência compartilhada não pode ser reutilizada.');

const selectorSource = section('function wireHomeRetreatSelector', 'async function renderHome');
assert.match(selectorSource, /filterOptions/, 'O seletor deve possuir busca local.');
assert.match(selectorSource, /retreat\?\.nome[\s\S]*retreat\?\.local[\s\S]*statusLabel[\s\S]*dateRange/, 'A busca deve considerar nome, local, situação e período.');
assert.match(selectorSource, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/, 'O combobox deve aceitar navegação pelas setas.');
assert.match(selectorSource, /event\.key === 'Enter'/, 'O combobox deve aceitar seleção pelo teclado.');
assert.match(selectorSource, /event\.key === 'Escape'/, 'O combobox deve permitir cancelar e restaurar o foco atual.');
assert.match(selectorSource, /if \(!retreat \|\| !canAccessRetreat\(retreat\)\)/, 'A permissão deve ser validada novamente ao selecionar.');
assert.match(selectorSource, /await loadData\(\);[\s\S]*await renderHome\(/, 'A troca deve recarregar os dados e renderizar novamente o Início.');
assert.match(selectorSource, /focusChangedMessage:[\s\S]*'Retiro em foco alterado'/, 'A troca concluída deve ser confirmada ao usuário.');
assert.doesNotMatch(selectorSource, /dataService\.save/, 'A seleção do foco não pode gravar cadastros no banco.');

const homeSource = section('async function renderHome', 'async function renderRetiros');
assert.match(homeSource, /const homeFocusRetreats = accessibleRetreats\(\)/, 'Somente retiros permitidos devem aparecer.');
assert.match(homeSource, /role="combobox"/, 'O campo deve usar semântica acessível de combobox.');
assert.match(homeSource, /role="listbox"/, 'As opções devem usar semântica acessível de lista.');
assert.match(homeSource, /Somente leitura/, 'Retiros concluídos devem ser identificados como somente leitura.');
assert.match(homeSource, /allStudents\.filter\(\(student\) => student\.retiroId === active\.id\)/, 'Cursistas individuais do Início devem ser filtrados pelo foco.');
assert.match(homeSource, /allCommunities\.filter\(\(community\) => community\.retiroId === active\.id\)/, 'Comunidades do Início devem ser filtradas pelo foco.');
assert.match(homeSource, /enrolments\.filter\(\(item\) => item\.retiroId === active\.id\)/, 'Equipe do Início deve ser filtrada pelo foco.');
assert.match(homeSource, /coupleStudentSource\(activeStudentFormType\)\.list\(active\.id\)/, 'SMP/EPC devem carregar somente a fonte do foco.');
assert.match(homeSource, /retreatId: active\?\.id \|\| ''/, 'Indicadores infantis devem receber explicitamente o retiro em foco.');
assert.match(source, /const activeStudentNavId = studentFormNavIds\[focusedRetreat\?\.tipoFichaCursista/, 'O menu deve atualizar o tipo de ficha conforme o foco.');
assert.match(source, /async function renderRetreat\(id[\s\S]*?setSelectedRetreatId\(retreat\.id\)/, 'Abrir um retiro pela opção Retiros deve continuar definindo o foco.');

const validationSource = section('async function renderValidacaoInscricoes', 'async function renderPessoa');
assert.match(validationSource, /entry\.retiroId === retreat\.id/, 'Validação deve permanecer isolada pelo foco.');
const communitiesSource = section('async function renderComunidades', 'const badgeSettingsKey');
assert.match(communitiesSource, /community\.retiroId === retreat\.id/, 'Comunidades devem permanecer isoladas pelo foco.');
assert.match(communitiesSource, /entry\.retiroId === retreat\.id/, 'Equipe usada nas comunidades deve permanecer isolada pelo foco.');
assert.match(communitiesSource, /activeCoupleStudentSource\.list\(retreat\.id\)/, 'Comunidades SMP/EPC devem carregar a fonte do foco.');
const badgesSource = section('async function renderCrachas', 'async function renderRecadoEquipe');
assert.match(badgesSource, /community\.retiroId === retreat\.id/, 'Crachás por comunidade devem permanecer isolados pelo foco.');
assert.match(badgesSource, /entry\.retiroId === retreat\.id/, 'Crachás da equipe devem permanecer isolados pelo foco.');
assert.match(badgesSource, /badgeCoupleStudentSource\.list\(retreat\.id\)/, 'Crachás SMP/EPC devem carregar a fonte do foco.');
const quadranteSource = section('async function renderQuadrante', 'function choices');
assert.match(quadranteSource, /student\.retiroId === retreat\.id/, 'Cursistas do Quadrante devem permanecer isolados pelo foco.');
assert.match(quadranteSource, /entry\.retiroId === retreat\.id/, 'Equipe do Quadrante deve permanecer isolada pelo foco.');
const receiverSource = section('async function renderRecebedor', 'async function renderPessoas');
assert.match(receiverSource, /: selectedRetreat\(\)/, 'O Recebedor interno deve continuar usando o foco.');
assert.match(receiverSource, /activeCoupleStudentSource\.list\(retreat\.id\)/, 'Recebedor SMP/EPC deve carregar a fonte do foco.');
assert.match(source, /renderPublicForm\(focusRetreat\.id, true\)/, 'Equipe de Trabalho interna deve abrir o retiro em foco.');
assert.match(source, /student\.retiroId === activeRetreat\.id/, 'Busca do cursista individual deve permanecer isolada pelo foco.');

assert.match(styles, /\.home-topline \{[\s\S]*grid-template-columns:minmax\(0, 1fr\) minmax\(300px, 390px\)/, 'Desktop deve posicionar o seletor ao lado do cabeçalho.');
assert.match(styles, /@media\(max-width:1100px\)[\s\S]*\.home-topline \{[\s\S]*grid-template-columns:1fr/, 'Telas menores devem colocar o seletor em uma linha própria.');
assert.match(styles, /\.home-retreat-option\.is-keyboard-active/, 'A opção ativa pelo teclado deve possuir destaque visual.');

console.log('Retiro em foco: preferência por usuário, UX responsiva e isolamento entre módulos validados.');
