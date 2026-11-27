# Pedidos das lojas — fluxo operacional

> Status: base de dados, recepção de pedidos aprovados, tela de Entregas e confirmação automática
> implementadas. Envio de status à loja e permissões por loja ainda
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
  `customerName`, `orderText`, `items` e `totalAmount` são uma cópia dos dados recebidos
  da loja para a operação de separação. A loja continua sendo a origem dos itens e preços.
- `StoreOrderStatusChange` registra status anterior, novo status, origem e, em mudanças
  humanas, o `membershipId` do autor. A aplicação deverá validar a membership ativa.
- As relações compostas `(tenantId, id)` impedem que um pedido seja ligado a uma loja ou
  contato de outro tenant.

## Status operacional

`PENDENTE_SEPARACAO → SEPARANDO → SEPARADO → EM_ROTA → ENTREGUE` é o caminho normal.
`OBSERVACAO` representa uma interrupção que exige revisão humana; a saída e a retomada
deverão ser definidas junto das regras de transição, antes de expor a ação na interface.
`PENDENTE` e `APROVADO` continuam sendo estados comerciais do sistema da loja.

Ao entrar em `EM_ROTA`, a aplicação copia o modo da loja para
`StoreOrder.deliveryConfirmationMode` e registra `enteredRouteAt`. No modo `AUTOMATIC`,
`deliveryDueAt` é duas horas depois. Se o pedido ainda estiver em `EM_ROTA` nesse horário,
um processamento periódico baseado no prazo persistido o move para `ENTREGUE`, com
`deliveryConfirmationSource = AUTOMATIC`. No modo `MANUAL`, não há prazo e um usuário
autorizado faz a movimentação, com fonte `MANUAL`. A origem automática significa entrega
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
  "orderText": "Texto opcional do pedido",
  "items": [{
    "productCode": "42", "description": "Peça azul", "quantity": "2.0000",
    "unitPrice": "25.5000", "lineTotal": "51.0000"
  }],
  "totalAmount": "51.0000"
}
```

O `storeId` e a credencial identificam a loja e seu tenant. O payload não escolhe o
tenant e não aceita campos extras. A resposta traz `id`, `status` e `created`. A
primeira chamada cria o pedido em `PENDENTE_SEPARACAO` e grava a entrada no histórico;
reenvios com o mesmo `externalOrderId` retornam o pedido existente sem reabrir o
status nem criar outro histórico. Um reenvio pode preencher itens ausentes em pedidos
recebidos antes desta atualização, mas não altera itens já gravados. Correções posteriores
dos itens e valores precisam de contrato próprio.

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

Também permite enviar, substituir ou remover uma logo JPEG, PNG ou WebP de até 5 MB.
A imagem é otimizada e armazenada sob chave da organização. A leitura exige acesso
ao tenant e ao módulo Entregas; o arquivo aparece nos filtros e nos pedidos.

`GET /api/store-orders/stores/manage`, `PATCH /api/store-orders/stores/:storeId` e
`POST /api/store-orders/stores/:storeId/rotate-secret`, `POST` e `DELETE`
`/api/store-orders/stores/:storeId/logo` exigem `OWNER` ou `ADMIN` e
sempre escopam a loja pelo tenant da membership. Listagens e edições não retornam o
hash nem a credencial. `GET /api/store-orders/stores` continua listando apenas lojas
ativas para a tela de Entregas.

## Contrato a implementar nas próximas etapas

Atualizações posteriores dos dados vindos da loja ainda precisam de contrato próprio.

## Vínculo de contato e aviso do status atual

`PATCH /api/store-orders/:id/contact` vincula um contato acessível ao usuário, sempre
no mesmo tenant e respeitando as lojas às quais ele tem acesso. O vínculo não muda
o status do pedido nem cria uma movimentação de status.

| Status ao vincular | Comportamento |
| --- | --- |
| Pendente separação ou Separando | Salva o contato para os próximos avisos, sem enviar mensagem. |
| Separado | Envia o aviso de que o pedido está separado e pronto para envio. |
| Em rota | Envia somente o aviso de que o pedido saiu para entrega. |
| Observação ou Entregue | Salva o vínculo sem enviar aviso. |

O envio usa o WhatsApp vinculado à loja e exige Atendimento disponível para a
organização e para o membro. A mensagem fica registrada no Atendimento. A resposta
inclui `contactNotification` (`SENT`, `FAILED` ou `SKIPPED`) e a tela informa o resultado.
Uma falha de envio preserva o vínculo; ausência de WhatsApp na loja também é informada.
Repetir o vínculo com o mesmo contato não reenvia a mensagem. Alterações concorrentes
do pedido são rejeitadas para evitar sobrescrever outro vínculo ou duplicar o aviso.
Nas mudanças para Separado e Em rota, `PATCH /api/store-orders/:id/status` também
aguarda o resultado do envio e retorna `statusNotification`. A tela mantém o detalhe
aberto para informar sucesso ou falha, com o status atualizado. Falta de contato,
WhatsApp não configurado na loja, telefone ausente e conexão indisponível têm retorno
explícito; não há envio por outra instância escolhida automaticamente. O envio usa
o mesmo fluxo registrado no Atendimento utilizado ao vincular o contato. Falhas não
disparam novas tentativas automáticas nesse fluxo; a mensagem que foi gravada pode ser
conferida e reenviada pelo Atendimento. Os logs `store-order.status-message.sent` e
`store-order.status-message.failed` identificam o pedido, o status e o resultado sem
incluir texto da mensagem, telefone ou credenciais.

## Tela de Entregas

A rota `/entregas` mostra filtros por loja, busca por pedido/cliente, contadores por
status e os 200 pedidos mais recentes. Os contadores consultam todos os pedidos
filtrados; a lista tem limite explícito enquanto não houver paginação. Cada etapa,
incluindo "Pendente separação", "Separando" e "Entregues", tem contagem e filtro próprios.
A organização escolhe quais desses cards aparecem em **Configurações → Lojas**.
Os cards visíveis dividem automaticamente a largura disponível na tela.
Somente `OWNER` e `ADMIN` alteram a escolha; ela vale para todos os usuários da organização
e é persistida no CRM. Ocultar um card não remove pedidos nem impede mudanças de status;
a lista e a busca continuam mostrando todos os pedidos. Se o card usado como filtro for
ocultado, a tela volta a exibir todos os pedidos. Mudanças são propagadas por realtime,
com nova consulta periódica como recuperação.
A lista é exibida em uma área com rolagem para não aumentar indefinidamente a página.

Novos pedidos e mudanças de status emitem `store-order.updated` apenas à sala do
tenant no realtime. A tela invalida sua lista ao receber o evento ou reconectar e
consulta novamente a cada 30 segundos para recuperar eventos perdidos.

O botão "Novo pedido" exige loja, contato do tenant, WhatsApp conectado e texto.
No celular, o formulário fica dentro da altura visível e rola internamente quando
necessário, mantendo a ação de envio acessível.
O CRM inicia ou retoma a conversa com o contato, envia o texto pelo WhatsApp e
cria um pedido manual com `externalOrderId` gerado no formato `manual:<uuid>` e origem
`CRM_MANUAL` no histórico. Esse registro não representa automaticamente uma venda
ou movimentação de estoque na loja. Um pedido recebido da loja e um pedido manual
nunca se confundem pelo identificador externo.
Se a mensagem for enviada mas o cadastro do pedido falhar, a tela mantém o formulário
e permite tentar salvar sem reenviar o texto. O cadastro usa `requestId` estável nas
tentativas para evitar duplicar o pedido se a resposta da API se perder.

O detalhe permite apenas transições previstas no backend e registra o autor pela
membership ativa. Os botões de transição usam as cores dos status exibidos nos cards.
Entrar em `EM_ROTA` copia o modo da loja e grava o prazo de duas
horas quando automático. O job `store-order.delivery.scan` consulta os prazos vencidos
a cada minuto, por tenant, e confirma somente pedidos ainda em rota no modo automático.
A transição e o histórico são atômicos e idempotentes; a origem é `AUTO_DELIVERY`, sem
autor humano, e a tela recebe `store-order.updated`. Após reiniciar a API, os prazos
vencidos ainda são encontrados no banco. O job usa a fila configurada por `QUEUE_DRIVER`
(`bullmq` com Redis no servidor). Se o módulo Entregas estiver desabilitado para a organização,
o processamento aguarda a reativação. No modo manual, o prazo fica vazio e a entrega
continua dependendo da ação de um usuário. Sair de rota para `OBSERVACAO` cancela o prazo.
A mudança da configuração da loja não altera pedidos que já entraram em rota.
A publicação das mudanças para o sistema da loja continua sendo uma etapa própria;
até lá, o status é confirmado somente no CRM.

Ao abrir um pedido, `GET /api/store-orders/:id` busca os itens, quantidades, preços
unitários e total gravados no CRM, sempre com escopo do tenant. A listagem não envia
os itens de todos os pedidos. Pedidos manuais e aprovações antigas sem esses dados
continuam exibindo o texto do pedido; as lojas não reenviam automaticamente saídas
já entregues antes desta atualização.
No celular, cada item aparece em um cartão com quantidade, valor unitário e total visíveis;
em telas maiores, os itens aparecem em tabela.

Na implantação, aplique a migration do CRM e atualize a API do CRM antes de atualizar
as lojas. A API anterior rejeita os novos campos. O payload continua aceitando pedidos
de instalações que ainda não enviam itens.

Evento do CRM para a loja: ID estável do evento, `externalOrderId`, status operacional,
data da mudança e versão/ordem da mudança. O receptor deverá rejeitar eventos antigos e
deduplicar repetições. A entrega confiável requer uma fila persistente de saída e histórico
de tentativas. Endpoints, credenciais e políticas de retry serão definidos antes da
implementação da integração.

As migrations são `20261105090000_store_order_foundation` e
`20261105100000_store_inbound_secret`; `20261107090000_store_logos` acrescenta o
armazenamento da logo e `20261107190000_store_order_items` guarda os itens e o total.
`20261107200000_delivery_visible_statuses` guarda os cards visíveis da organização;
organizações existentes começam com todos os cards habilitados.
O sistema de pedidos registra a aprovação em
uma fila local persistente e envia ao endpoint acima em segundo plano. Cada instalação
configura URL, ID e credencial próprios. Ver `docs/crm-order-approval.md` no repositório
do sistema de pedidos.
