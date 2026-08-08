const financeStores = ['financeiro_categorias', 'financeiro_fornecedores', 'financeiro_produtos', 'financeiro_despesas', 'financeiro_cotacoes', 'financeiro_movimentos', 'financeiro_auditoria'];
const stores = ['retiros', 'pessoas', 'adesoes', 'casais', 'cursistas', 'comunidades', 'crachas', 'configuracoes', 'usuarios', 'perfis', 'permissoes', 'perfil_permissoes', 'usuario_permissoes', 'usuario_retiros', ...financeStores];

module.exports = { stores, financeStores };
