# EPC Retiros

Aplicacao para cadastro e organizacao de retiros EPC.

## Executar localmente

```powershell
npm run dev
```

Abra `http://localhost:5173` no navegador.

Sem variaveis do Supabase, a aplicacao usa `database/db.json` como banco local de desenvolvimento.

## Area restrita

O acesso administrativo exige login e senha. Para desenvolvimento local, crie um arquivo `.env` ou defina as variaveis antes de iniciar:

```powershell
$env:EPC_AUTH_SECRET="troque-por-um-texto-longo"
$env:EPC_ADMIN_USER="admin"
$env:EPC_ADMIN_PASSWORD="sua-senha"
npm run dev
```

Tambem e possivel configurar tres niveis de acesso:

```text
EPC_USERS_JSON=[{"username":"admin","password":"senha","role":"admin"},{"username":"gestor","password":"senha","role":"gestor"},{"username":"consulta","password":"senha","role":"consulta"}]
```

Os papeis `admin`, `gestor` e `consulta` ja ficam registrados na sessao para refinamento das permissoes depois da publicacao.

## Supabase

1. Crie um projeto no Supabase.
2. Execute o SQL de `supabase-schema.sql` no SQL Editor.
3. Configure as variaveis:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
EPC_AUTH_SECRET=troque-por-um-texto-longo-aleatorio
EPC_ADMIN_USER=admin
EPC_ADMIN_PASSWORD=troque-esta-senha
```

Com essas variaveis presentes, a API passa a gravar no Supabase. Sem elas, usa o JSON local.

## Vercel

1. Suba este projeto para o GitHub.
2. Importe o repositorio na Vercel.
3. Cadastre as variaveis de ambiente acima em Project Settings > Environment Variables.
4. Publique.

A Vercel usa os arquivos em `api/` como funcoes serverless e serve os HTML/CSS/JS como arquivos estaticos.
