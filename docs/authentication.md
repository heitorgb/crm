# Autenticação e autorização — OrderUp CRM

> Status: **Planejado**. Nenhum endpoint de autenticação foi implementado nesta fase. Este documento
> registra as decisões para orientar a implementação futura.

## Objetivo

Autenticar o usuário, identificar o tenant ativo e preencher o `TenantContext` de forma segura.

## Estratégia planejada

- **Access token JWT** de curta duração.
- **Refresh token** de longa duração, com rotação, armazenado apenas como **hash** no banco.
- O cliente envia o access token no header `Authorization: Bearer <token>`.
- O tenant ativo faz parte do fluxo de seleção/entrada do usuário e precisa ser **validado por
  membership**, nunca aceito cegamente.

### Claims mínimas do access token

- `sub` (userId)
- `tenantId` (tenant ativo selecionado)
- `membershipId` (id de `TenantUser`)
- `role`

## Validação de membership (obrigatória)

Para cada requisição autenticada:

1. Verificar a assinatura e a validade do token.
2. Carregar o `TenantUser` por `(userId, tenantId)`.
3. Garantir que o membership **existe e está ativo**.
4. Só então preencher o `TenantContext`.

Sem membership válida, a requisição é rejeitada (403/401 conforme o caso).

## Preenchimento do TenantContext

O guard de autenticação chama:

```ts
tenantContextService.setContext({
  tenantId,
  userId,
  membershipId,
  role,
});
```

A partir daí, services de negócio usam `requireContext()` para escopar queries por tenant.

## Segurança

- Nunca logar `password`, `access token`, `refresh token`, API keys ou secrets.
- `passwordHash` nunca sai em respostas.
- Refresh tokens são persistidos **hasheados** e rotacionados.
- Erros de autenticação não revelam detalhes internos.
- Segredos JWT vêm do ambiente validado; sem defaults em produção.

## Variáveis de ambiente (a adicionar na fase de auth)

Serão incluídas na validação de ambiente no momento da implementação:

```text
JWT_ACCESS_SECRET
JWT_ACCESS_TTL
JWT_REFRESH_SECRET
JWT_REFRESH_TTL
```

Não foram adicionadas agora para evitar configuração especulativa antes de existir consumidor.

## Autorização

- `role` no `TenantUser` define o papel no tenant.
- Regras de permissão (RBAC) serão implementadas quando os papéis forem definidos.
- Não criar enums/roles especulativos.
