# Pedidos das lojas — etapa 1: modelo e contrato

> Status: base de dados, recepção de pedidos aprovados e tela inicial de Entregas
> implementadas. Envio de status à loja, temporizador e permissões por loja ainda
> não estão implementados.

Entregas é controlado pelo módulo `deliveries` da organização. Ao desabilitá-lo,
o menu, a tela e as operações da API ficam indisponíveis. O sistema de pedidos
preserva aprovações pendentes na fila local e volta a tentar após a reativação.

## Responsabilidades

Cada loja opera seu próprio sistema de pedidos e banco de dados. O pedido nasce na loja;
itens, valores, estoque e aprovação comercial continuam sob responsabilidade dela. O CRM
centraliza o andamento operacional após a aprovação. Não há acesso direto entre bancos.

Quando o sistema da loja aprova um pedido, ele deverá comunicar o fato ao CRM. O CRM cria
ou atualiza um `StoreOrder` identificado por `(storeId, externalOrderId)` e inicia seu status
em `PENDENTE_SEPARACAO`. Repetir o mesmo evento não pode criar outro pedido. Pedido ainda
pendente de aprovação na loja não aparece no fluxo operacional do CRM.

O usuário movimentará o pedido no CRM. Cada mudança confirmada será registrada em
`StoreOrderStatusChange` e, em etapa posterior, enviada ao sistema da loja como evento
idempotente. A cópia do status operacional na loja não deve ser editada de forma independente.
Falhas de entrega do evento deverão ser mostradas como falha de sincronização, sem desfazer
uma movimentação já confirmada no CRM.

## Dados desta etapa

- `Store` pertence a um tenant e tem `externalCode` único dentro dele. O código identifica
  qual integração de loja enviou o pedido. `deliveryConfirmationMode` começa em `AUTOMATIC`.
- `StoreOrder` pertence ao mesmo tenant da loja; `externalOrderId` é único por loja.
  `contactId` é opcional e, quando informado, deve apontar para um contato do mesmo tenant.
  `customerName` e `orderText` são dados de apresentação recebidos da loja, não um segundo
  cadastro de itens ou preços.
- `StoreOrderStatusChange` registra status anterior, novo status, origem e, em mudanças
  humanas, o `membershipId` do autor. A aplicação deverá validar a membership ativa.
- As relações compostas `(tenantId, id)` impedem que um pedido seja ligado a uma loja ou
  contato de outro tenant.

## Status operacional

`PENDENTE_SEPARACAO → SEPARANDO → SEPARADO → EM_ROTA → ENTREGUE` é o caminho normal.
`OBSERVACAO` representa uma interrupção que exige revisão humana; a saída e a retomada
deverão ser definidas junto das regras de transição, antes de expor a ação na interface.
`PENDENTE` e `APROVADO` continuam sendo estados comerciais do sistema da loja.

Ao entrar em `EM_ROTA`, a aplicação deverá copiar o modo da loja para
`StoreOrder.deliveryConfirmationMode` e registrar `enteredRouteAt`. No modo `AUTOMATIC`,
`deliveryDueAt` será duas horas depois. Se o pedido ainda estiver em `EM_ROTA` nesse horário,
um processamento persistente o moverá para `ENTREGUE`, com
`deliveryConfirmationSource = AUTOMATIC`. No modo `MANUAL`, não haverá prazo e um usuário
autorizado fará a movimentação, com fonte `MANUAL`. A origem automática significa entrega
presumida, sem confirmação do destinatário. A configuração copiada preserva a regra de
pedidos já em rota quando a loja alterar seu modo posteriormente.

## Recepção de pedido aprovado (etapa 2)

Um `OWNER` ou `ADMIN` do tenant cadastra a loja em `POST /api/store-orders/stores` com
`name` e `externalCode`. A resposta traz `id` e `secret` (`whk_...`) uma única vez. O
hash da credencial fica na loja; o valor completo deve ser guardado com segurança no
sistema de pedidos correspondente. Cada loja tem sua própria credencial.

Após aprovar o pedido, a loja chama:

```http
POST /api/store-orders/stores/{storeId}/approved
Authorization: Bearer <secret-da-loja>
Content-Type: application/json

{
  "externalOrderId": "123",
  "approvedAt": "2026-11-05T12:00:00.000Z",
  "customerName": "Ana",
  "orderText": "Texto opcional do pedido"
}
```

O `storeId` e a credencial identificam a loja e seu tenant. O payload não escolhe o
tenant e não aceita campos extras. A resposta traz `id`, `status` e `created`. A
primeira chamada cria o pedido em `PENDENTE_SEPARACAO` e grava a entrada no histórico;
reenvios com o mesmo `externalOrderId` retornam o pedido existente sem reabrir o
status nem criar outro histórico. Dados alterados em reenvios não sobrescrevem o pedido;
um evento de correção deverá ter contrato próprio.

## Cadastro de lojas no CRM

Em **Configurações → Lojas** (`/configuracoes?tab=stores`), `OWNER` e `ADMIN`
podem cadastrar cada instalação com nome, código externo único e modo de confirmação
de entrega. O cadastro devolve ID e credencial de integração, exibida somente uma vez.
Esses valores alimentam `CRM_STORE_ID` e `CRM_STORE_SECRET` na instalação da loja.

A tela permite renomear, alterar o modo entre `AUTOMATIC` e `MANUAL`, ativar/desativar
e renovar a credencial. Renovar invalida imediatamente a anterior; a instalação da
loja precisa receber a nova credencial. Uma loja inativa não recebe novos eventos de
aprovação e não aparece na seleção de pedidos. Pedidos existentes permanecem no CRM.
O modo alterado não modifica o modo copiado para pedidos que já entraram em rota.

`GET /api/store-orders/stores/manage`, `PATCH /api/store-orders/stores/:storeId` e
`POST /api/store-orders/stores/:storeId/rotate-secret` exigem `OWNER` ou `ADMIN` e
sempre escopam a loja pelo tenant da membership. Listagens e edições não retornam o
hash nem a credencial. `GET /api/store-orders/stores` continua listando apenas lojas
ativas para a tela de Entregas.

## Contrato a implementar nas próximas etapas

O vínculo do pedido recebido com um `Contact` do CRM e atualizações posteriores dos
dados vindos da loja ainda precisam de contrato próprio.

## Tela de Entregas

A rota `/entregas` mostra filtros por loja, busca por pedido/cliente, contadores por
status e os 200 pedidos mais recentes. Os contadores consultam todos os pedidos
filtrados; a lista tem limite explícito enquanto não houver paginação. O grupo
"Pendentes" soma `PENDENTE_SEPARACAO` e `SEPARANDO`.

Novos pedidos e mudanças de status emitem `store-order.updated` apenas à sala do
tenant no realtime. A tela invalida sua lista ao receber o evento ou reconectar e
consulta novamente a cada 30 segundos para recuperar eventos perdidos.

O botão "Novo pedido" exige loja, contato do tenant e texto. Ele cria um pedido
manual com `externalOrderId` gerado no formato `manual:<uuid>` e origem
`CRM_MANUAL` no histórico. Esse registro não representa automaticamente uma venda
ou movimentação de estoque na loja. Um pedido recebido da loja e um pedido manual
nunca se confundem pelo identificador externo.

O detalhe permite apenas transições previstas no backend e registra o autor pela
membership ativa. Entrar em `EM_ROTA` copia o modo da loja e grava o prazo de duas
horas quando automático. O processamento do prazo e a publicação das mudanças para
o sistema da loja serão implementados em etapa própria; até lá, o status é confirmado
somente no CRM.

Evento do CRM para a loja: ID estável do evento, `externalOrderId`, status operacional,
data da mudança e versão/ordem da mudança. O receptor deverá rejeitar eventos antigos e
deduplicar repetições. A entrega confiável requer uma fila persistente de saída e histórico
de tentativas. Endpoints, credenciais e políticas de retry serão definidos antes da
implementação da integração.

As migrations são `20261105090000_store_order_foundation` e
`20261105100000_store_inbound_secret`. O sistema de pedidos registra a aprovação em
uma fila local persistente e envia ao endpoint acima em segundo plano. Cada instalação
configura URL, ID e credencial próprios. Ver `docs/crm-order-approval.md` no repositório
do sistema de pedidos.
