-- EPC Retiros - Usuarios e permissoes
-- Execute apos o supabase-schema.sql. O projeto usa a tabela generica epc_store.

insert into public.epc_store (store, id, data)
values
  ('perfis', 'admin', '{"id":"admin","nome":"Admin","codigo":"admin","descricao":"Acesso irrestrito ao sistema.","locked":true}'::jsonb),
  ('perfis', 'coordenador_geral', '{"id":"coordenador_geral","nome":"Coordenador Geral","codigo":"coordenador_geral","descricao":"Acesso amplo, exceto exclusoes sensiveis de usuarios.","locked":false}'::jsonb),
  ('perfis', 'coordenador_retiro', '{"id":"coordenador_retiro","nome":"Coordenador do retiro","codigo":"coordenador_retiro","descricao":"Acesso operacional ao retiro vinculado.","locked":false}'::jsonb)
on conflict (store, id) do update set data = excluded.data;

with permission_seed(id, modulo, descricao) as (
  values
    ('inicio.ver','Inicio','Ver painel inicial'),
    ('retiros.ver','Retiros','Ver retiros'),
    ('retiros.criar','Retiros','Criar retiros'),
    ('retiros.editar','Retiros','Editar retiros'),
    ('retiros.publicar','Retiros','Publicar link'),
    ('retiros.excluir','Retiros','Excluir retiros'),
    ('pessoas.ver','Equipe de trabalho','Ver voluntarios'),
    ('pessoas.criar','Equipe de trabalho','Cadastrar voluntarios'),
    ('pessoas.editar','Equipe de trabalho','Editar voluntarios'),
    ('pessoas.excluir','Equipe de trabalho','Excluir adesoes'),
    ('validacao-inscricoes.ver','Validacao','Ver validacao'),
    ('validacao-inscricoes.validar','Validacao','Validar inscricoes'),
    ('cursista.ver','Cursista','Ver cursistas'),
    ('cursista.criar','Cursista','Cadastrar cursistas'),
    ('cursista.editar','Cursista','Editar cursistas'),
    ('cursista.excluir','Cursista','Excluir cursistas'),
    ('comunidades.ver','Comunidades','Ver comunidades'),
    ('comunidades.criar','Comunidades','Criar comunidades'),
    ('comunidades.editar','Comunidades','Editar comunidades'),
    ('comunidades.excluir','Comunidades','Excluir comunidades'),
    ('crachas.ver','Crachas','Ver crachas'),
    ('crachas.editar','Crachas','Editar modelos'),
    ('crachas.imprimir','Crachas','Imprimir crachas'),
    ('crachas.excluir','Crachas','Excluir modelos'),
    ('quadrante.ver','Quadrante','Ver quadrante'),
    ('quadrante.imprimir','Quadrante','Imprimir quadrante'),
    ('recebedor.ver','Recebedor','Ver recebedor'),
    ('recebedor.editar','Recebedor','Editar pagamentos'),
    ('usuarios.ver','Usuarios e permissoes','Ver usuarios e permissoes'),
    ('usuarios.criar','Usuarios e permissoes','Criar usuarios'),
    ('usuarios.editar','Usuarios e permissoes','Editar usuarios e permissoes'),
    ('usuarios.excluir','Usuarios e permissoes','Excluir usuarios')
)
insert into public.epc_store (store, id, data)
select 'permissoes', id, jsonb_build_object('id', id, 'modulo', modulo, 'descricao', descricao)
from permission_seed
on conflict (store, id) do update set data = excluded.data;

with permission_seed(id) as (
  values
    ('inicio.ver'),('retiros.ver'),('retiros.criar'),('retiros.editar'),('retiros.publicar'),('retiros.excluir'),
    ('pessoas.ver'),('pessoas.criar'),('pessoas.editar'),('pessoas.excluir'),
    ('validacao-inscricoes.ver'),('validacao-inscricoes.validar'),
    ('cursista.ver'),('cursista.criar'),('cursista.editar'),('cursista.excluir'),
    ('comunidades.ver'),('comunidades.criar'),('comunidades.editar'),('comunidades.excluir'),
    ('crachas.ver'),('crachas.editar'),('crachas.imprimir'),('crachas.excluir'),
    ('quadrante.ver'),('quadrante.imprimir'),('recebedor.ver'),('recebedor.editar'),
    ('usuarios.ver'),('usuarios.criar'),('usuarios.editar'),('usuarios.excluir')
),
profile_seed(perfil_id, permissao_id, permitido) as (
  select 'admin', id, true from permission_seed
  union all
  select 'coordenador_geral', id, id <> 'usuarios.excluir' from permission_seed
  union all
  select 'coordenador_retiro', id, id in (
    'inicio.ver','retiros.ver','retiros.editar','pessoas.ver','pessoas.criar','pessoas.editar','pessoas.excluir',
    'validacao-inscricoes.ver','validacao-inscricoes.validar','cursista.ver','cursista.criar','cursista.editar',
    'comunidades.ver','comunidades.criar','comunidades.editar','crachas.ver','crachas.editar','crachas.imprimir',
    'quadrante.ver','quadrante.imprimir','recebedor.ver','recebedor.editar'
  ) from permission_seed
)
insert into public.epc_store (store, id, data)
select
  'perfil_permissoes',
  perfil_id || ':' || permissao_id,
  jsonb_build_object('id', perfil_id || ':' || permissao_id, 'perfilId', perfil_id, 'permissaoId', permissao_id, 'permitido', permitido)
from profile_seed
on conflict (store, id) do update set data = excluded.data;

-- O Admin inicial continua vindo das variaveis EPC_ADMIN_USER/EPC_ADMIN_PASSWORD
-- ate que usuarios sejam cadastrados em "Usuarios e permissoes".
