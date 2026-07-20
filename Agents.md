# Instrucoes Para Agentes de Codigo

Este projeto contem dados cadastrados de retiros, fichas de adesao da equipe de trabalho e fichas de cursistas. Esses dados devem ser tratados como historico sensivel.

## Regra Principal

Nunca alterar, limpar, migrar, sobrescrever ou remover informacoes ja cadastradas no banco de dados sem antes deixar claro para o usuario:

- qual dado pode ser afetado;
- qual arquivo, tabela, store ou colecao sera alterado;
- qual e o risco de efeito colateral;
- se existe possibilidade de perda de informacao;
- qual backup, auditoria ou teste sera usado antes da alteracao.

Essa regra vale especialmente para:

- `adesoes`;
- `cursistas`;
- `pessoas`;
- `casais`;
- `comunidades`;
- `retiros` quando a alteracao puder afetar inscricoes ja existentes;
- `database/db.json`;
- scripts de seed, migracao, limpeza, importacao ou sincronizacao.

## Fichas de Adesao e Cursistas

Dados salvos em fichas de adesao e cursistas sao historicos e devem ser preservados.

Toda alteracao no codigo deve preservar integralmente os dados ja cadastrados em `adesoes` e `cursistas`. Nenhuma mudanca de configuracao, layout, setores, dias, defaults, links, textos, formularios ou logica de exibicao pode zerar, sobrescrever, remover ou modificar informacoes existentes sem autorizacao explicita do usuario, aviso de risco, auditoria previa e backup.

Alteracoes em configuracoes, setores padrao, dias do retiro, textos, layout, links publicos ou valores default devem afetar apenas opcoes futuras, a menos que o usuario autorize explicitamente uma migracao dos dados ja cadastrados.

Em particular:

- nao zerar `setores` de adesoes existentes;
- nao zerar `dias` de adesoes existentes;
- nao remover dados pessoais de fichas existentes;
- nao alterar vinculos de `retiroId`, `pessoaId`, `casalId` ou CPF sem autorizacao explicita;
- nao sobrescrever fichas existentes por causa de mudancas em listas de opcoes atuais.

Se uma estrutura de retiro mudar, como inclusao, exclusao ou renomeacao de setor, as fichas antigas devem manter os setores e dias que ja estavam gravados, mesmo que esses valores nao estejam mais disponiveis para novas inscricoes.

## Antes de Mudancas Sensiveis

Antes de executar qualquer acao que possa afetar dados cadastrados, o agente deve:

1. explicar o risco ao usuario;
2. recomendar backup ou snapshot;
3. auditar quantos registros podem ser afetados;
4. preferir mudancas somente no codigo de exibicao/configuracao;
5. pedir confirmacao explicita se houver chance de modificar dados reais.

## Preferencia de Implementacao

Ao ajustar o codigo, preferir protecoes defensivas:

- preservar valores existentes quando formularios antigos retornarem campos vazios acidentalmente;
- validar antes de salvar uma ficha existente sem campos criticos;
- separar configuracao atual do retiro de dados historicos das fichas;
- criar testes ou scripts de auditoria para garantir que mudancas estruturais nao alterem `adesoes` ou `cursistas`.
- bloquear salvamentos que tentem gravar ficha existente com campos previamente preenchidos ausentes, vazios ou zerados, salvo quando houver uma autorizacao explicita no codigo e do usuario.
