const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('adminApp.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const articles = fs.readFileSync('helpArticles.js', 'utf8');

assert.match(source, /import \{ helpArticles \} from '\.\/helpArticles\.js';/, 'A ajuda deve carregar perguntas e respostas de um arquivo dedicado.');
assert.match(source, /function openHelpSearch\(navItems = \[\]\)/, 'A ajuda deve abrir em uma janela sobreposta baseada nos itens visíveis do menu.');
assert.match(source, /const menuTargets = navItems\.map\(\(\[id, label\]\) => \(\{ id, label: htmlToText\(label\) \}\)\)/, 'A busca deve partir dos itens de menu já filtrados por permissão.');
assert.match(source, /const targetByLabel = new Map\(menuTargets\.map\(\(item\) => \[normalizeText\(item\.label\), item\]\)\)/, 'A ajuda deve resolver o destino pelo nome visível do menu.');
assert.match(source, /\.map\(\(article\) => \(\{ \.\.\.article, resolvedTarget: targetByLabel\.get\(normalizeText\(article\.target\)\) \}\)\)/, 'A ajuda deve converter o target visível para o código interno da tela.');
assert.match(source, /\.filter\(\(article\) => article\.resolvedTarget\)/, 'A ajuda deve mostrar apenas perguntas ligadas a telas permitidas.');
assert.match(source, /id="help-search-button">Ajuda<\/button>/, 'O menu deve exibir a opção Ajuda.');
assert.match(source, /openHelpSearch\(navItems\)/, 'O botão Ajuda deve abrir a busca usando a lista atual de navegação.');
assert.match(source, /normalizeText\(`\$\{topic\.question\} \$\{topic\.answer\} \$\{topic\.targetLabel\} \$\{topic\.keywords \|\| ''\}`\)\.includes\(term\)/, 'A busca deve considerar pergunta, resposta, tela e palavras relacionadas.');
assert.match(source, /<article class="help-search-result"><h3>\$\{escapeHtml\(topic\.question\)\}<\/h3><p>\$\{escapeHtml\(topic\.answer\)\}<\/p>/, 'Os resultados devem exibir pergunta e resposta.');
assert.match(styles, /\.help-search-overlay[\s\S]*position:fixed/, 'A janela de ajuda deve aparecer como sobreposição.');
assert.match(styles, /\.help-search-result[\s\S]*border:1px solid #cde8f5/, 'As perguntas e respostas devem ter estilo próprio.');
assert.match(styles, /\.help-search-result a[\s\S]*text-decoration:none/, 'Os resultados devem manter atalho clicável para a tela relacionada.');
assert.match(articles, /export const helpArticles = \[[\s\S]*question: '[^']*crachás\?'[\s\S]*answer: 'Abra Crachás/, 'O arquivo de ajuda deve conter perguntas e respostas editáveis.');
assert.match(articles, /target: 'Links de cadastro'/, 'O arquivo de ajuda deve usar o nome visível do menu.');
assert.doesNotMatch(articles, /target: '(inicio|retiros|configuracoes|pessoas|validacao-inscricoes|cursista|cursista-epc|cursista-smp|comunidades|recado-equipe|crachas|quadrante|recebedor|relatorios|financeiro|alterar-senha|backup|usuarios)'/, 'O arquivo de ajuda não deve exigir identificadores internos no target.');

console.log('Ajuda: perguntas e respostas pesquisáveis validadas sem alterar fluxos de dados.');
