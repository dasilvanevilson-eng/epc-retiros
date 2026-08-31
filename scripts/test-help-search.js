const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('adminApp.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

assert.match(source, /const helpTopicDetails = \{[\s\S]*crachas:[\s\S]*financeiro:[\s\S]*usuarios:/, 'A ajuda deve ter um catálogo pesquisável de tópicos principais.');
assert.match(source, /function openHelpSearch\(navItems = \[\]\)/, 'A ajuda deve abrir em uma janela sobreposta baseada nos itens visíveis do menu.');
assert.match(source, /const topics = navItems\.map/, 'A busca deve reutilizar os itens de menu já filtrados por permissão.');
assert.match(source, /id="help-search-button">Ajuda<\/button>/, 'O menu deve exibir a opção Ajuda.');
assert.match(source, /openHelpSearch\(navItems\)/, 'O botão Ajuda deve abrir a busca usando a lista atual de navegação.');
assert.match(source, /normalizeText\(`\$\{topic\.label\} \$\{topic\.detail\} \$\{topic\.keywords\}`\)\.includes\(term\)/, 'A busca deve considerar nome, descrição e palavras relacionadas.');
assert.match(styles, /\.help-search-overlay[\s\S]*position:fixed/, 'A janela de ajuda deve aparecer como sobreposição.');
assert.match(styles, /\.help-search-results a[\s\S]*text-decoration:none/, 'Os resultados devem ter estilo de atalhos clicáveis.');

console.log('Ajuda: busca global de tópicos validada sem alterar fluxos de dados.');
