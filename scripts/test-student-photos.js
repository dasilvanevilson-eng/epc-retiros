const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.EPC_AUTH_SECRET = 'student-photo-test-secret';
const { createPublicPhotoTicket, verifyPublicPhotoTicket, validatePhotoBuffer } = require('../studentPhotoService');

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

assert.deepEqual(validatePhotoBuffer(jpeg(900, 1200), 'individual'), { width: 900, height: 1200 });
assert.deepEqual(validatePhotoBuffer(jpeg(1200, 900), 'smp'), { width: 1200, height: 900 });
assert.deepEqual(validatePhotoBuffer(jpeg(1200, 900), 'epc'), { width: 1200, height: 900 });
assert.throws(() => validatePhotoBuffer(jpeg(900, 1200), 'smp'), /1200 x 900/);
assert.throws(() => validatePhotoBuffer(Buffer.from('nao-e-imagem'), 'individual'), /JPEG valido/);

const ticket = createPublicPhotoTicket({ token: 'link-publico', retreatId: 'r1', type: 'individual', recordId: 'student-1', fileNumber: 7 });
assert.deepEqual(verifyPublicPhotoTicket(ticket, 'link-publico'), {
  tokenHash: require('crypto').createHash('sha256').update('link-publico').digest('hex'),
  retreatId: 'r1', type: 'individual', recordId: 'student-1', fileNumber: '7',
  exp: verifyPublicPhotoTicket(ticket, 'link-publico').exp,
});
assert.throws(() => verifyPublicPhotoTicket(ticket, 'outro-link'), /invalida/);

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase-cursista-fotos.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'studentPhotoClient.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const backup = fs.readFileSync(path.join(root, 'backupService.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(migration, /'cursista-fotos'.*false.*2097152.*image\/jpeg/s, 'Bucket deve ser privado e aceitar somente JPEG de ate 2 MB.');
assert.match(migration, /alter table public\.cursista_fotos enable row level security/i);
assert.doesNotMatch(migration, /create policy/i, 'A migracao nao deve conceder acesso direto anonimo ou autenticado.');
assert.match(migration, /where ativo/i, 'Deve existir apenas uma foto ativa por ficha.');
assert.match(migration, /p_permitir_substituir/i, 'Ativacao deve diferenciar inclusao publica e substituicao logada.');
assert.match(api, /action === 'foto'[\s\S]*verifyPublicPhotoTicket[\s\S]*allowReplace: false/);
assert.match(api, /resource === 'cursista-foto'[\s\S]*denyIfMissingPermission[\s\S]*allowReplace: true/);
assert.match(api, /req\.method === 'DELETE'[\s\S]*x-confirm-photo-deletion[\s\S]*deleteStudentPhotos/, 'Exclusao deve exigir permissao e confirmacao explicita no servidor.');
assert.match(api, /resource === 'cursistas'[\s\S]*deleteStudentPhotos\('individual'[\s\S]*deleteRecord/, 'Excluir ficha individual deve remover suas fotos antes do cadastro.');
assert.match(api, /deleteStudentPhotos\(resource === 'cursista-epc' \? 'epc' : 'smp'[\s\S]*deleteCoupleStudent/, 'Excluir ficha SMP ou EPC deve remover suas fotos antes do cadastro.');
assert.match(client, /\['heic'.*'mif1'.*'msf1'\]/s);
assert.match(client, /heic2any\.min\.js/);
assert.match(client, /\[0\.92, 0\.89, 0\.86, 0\.85\]/);
assert.match(client, /publicMode\) deleteButton\.remove\(\)/, 'A exclusao nao pode aparecer no acesso publico.');
assert.match(client, /setEditable\(editable\)[\s\S]*controls\.hidden/, 'Funcoes da foto devem ficar disponiveis apenas durante inclusao ou edicao.');
assert.match(client, /Excluir definitivamente a foto e todas as versões anteriores/, 'A interface deve confirmar a irreversibilidade.');
assert.match(client, /900, height: 1200[\s\S]*1200, height: 900/);
assert.match(app, /attachStudentPhotoField[\s\S]*uploadPublic[\s\S]*uploadLogged/);
assert.match(app, /mountTarget: app\.querySelector\('\.student-file-number'\)/, 'Individual deve posicionar foto ao lado do numero da ficha.');
assert.match(app, /mountTarget: app\.querySelector\('\.cursista-smp-file-number'\)/, 'SMP e EPC devem posicionar foto ao lado do numero da ficha.');
assert.match(app, /student-registration-actions'\)\?\.append\(app\.querySelector\('\.student-heading-actions'\)\)/, 'Acoes Individual devem ficar junto de Incluir novo.');
assert.match(app, /cursista-smp-tool-actions'\)\?\.append\(deleteButton\)/, 'Excluir SMP e EPC deve ficar junto de Novo, Editar e Imprimir.');
assert.match(app, /id="new-cursista-smp">Incluir novo<\/button>/, 'SMP e EPC devem exibir Incluir novo por extenso.');
assert.doesNotMatch(styles, /#new-student::before\s*\{[\s\S]*?content:\s*'\+'/s, 'Individual nao deve substituir Incluir novo por um simbolo no mobile.');
assert.match(styles, /@media\(max-width:720px\)[\s\S]*?\.student-screen \.student-registration-tools\s*\{[\s\S]*?grid-template-columns:minmax\(0, 1fr\)/, 'A barra Individual deve ocupar a largura disponivel no mobile.');
assert.match(styles, /@media\(max-width:720px\)[\s\S]*?\.cursista-smp-tool-actions\s*\{[\s\S]*?grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/, 'As barras SMP e EPC devem organizar os comandos em grade no mobile.');
assert.match(backup, /\['cursista_fotos', \['id'\]\]/);
assert(fs.existsSync(path.join(root, 'assets', 'vendor', 'heic2any.min.js')));
assert(fs.existsSync(path.join(root, 'assets', 'vendor', 'heic2any.LICENSE.md')));

console.log('Fotos de cursistas: formatos, recorte, autorizacao, privacidade e backup de metadados validados.');
