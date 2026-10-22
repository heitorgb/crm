# Design — OrderUp CRM

> Identidade visual do produto autenticado e relação com a tela de login. Este documento é a
> referência para novos componentes e ajustes visuais. Os valores canônicos ficam em
> `frontend/src/index.css` e `frontend/tailwind.config.ts`.

## Princípios

1. **Uma identidade só.** Login e CRM compartilham a mesma paleta, tipografia, raios e linguagem de
   estados. O login pode ser mais expressivo; o CRM mantém a mesma origem visual.
2. **Verde é ação e seleção.** O verde da marca destaca botões primários, itens ativos, foco e
   indicadores positivos. Ciano e roxo não são usados como cor de superfície.
3. **Superfícies discretas.** Canvas neutro, cards brancos (ou escuros elevados no tema dark), borda
   de 1px e sombra suave. Elevação forte somente em overlays.
4. **Densidade preservada.** O atendimento e as tabelas são operacionais. Não aumentar paddings,
   alturas de controles ou larguras do chat para ganhar “respiro”.
5. **Hierarquia por tipografia e contraste.** Títulos com tracking negativo, labels curtos e
   metadados menores. A cor não substitui a hierarquia.
6. **Estados previsíveis.** Hover, foco, seleção, erro, carregamento e desabilitado seguem o mesmo
   padrão em todos os componentes.

## Relação login ↔ CRM

- A tela de login é sempre escura (`auth-screen`), com canvas em gradiente, grid sutil e CTA
  esmeralda. Ela é a referência estética, não um tema obrigatório para o CRM.
- O CRM usa os temas `light`, `dark` e `system`. O tema escuro foi aproximado do canvas do login;
  o tema claro mantém o canvas neutro e os cards brancos.
- Componentes internos não usam os gradientes de fundo do login. O detalhe de marca fica no CTA, no
  logo, nos ícones de estado e no item ativo da navegação.
- A tela de login e os fluxos de recuperação de senha não devem ser redesenhados ao ajustar o CRM.

## Tokens

| Token                        | Light     | Dark      |
| ---------------------------- | --------- | --------- |
| `background`                 | `#F5F6FA` | `#0C0D12` |
| `foreground`                 | `#0A0F1E` | `#F2F4F8` |
| `surface` / `surface-hover`  | `#FFFFFF` / `#F2F3F8` | `#161923` / `#212531` |
| `card` / `popover`           | `#FFFFFF` | `#161923` |
| `border` / `input`           | `#DEE2ED` / `#D5D9E7` | `#242733` / `#2C313F` |
| `muted` / `muted-foreground` | `#EEF0F6` / `#636B7E` | `#1F232E` / `#97A1B5` |
| `primary`                    | `#21C45D` | `#21C45D` |
| `primary-hover`              | `#16A34A` | `#4DDB81` |
| `primary-strong`             | `#189546` | `#15843E` |
| `primary-light`              | `#DEFCE9` | `#163B24` |
| `success` / `warning`        | `#16A34A` / `#D78109` | `#28BD5F` / `#F5BD14` |
| `danger` / `info`            | `#DC2626` / `#0AA6C2` | `#EC5151` / `#0DD0F2` |
| `sidebar` / `sidebar-accent` | `#FFFFFF` / `#EBF9F0` | `#0E1015` / `#1F232E` |

- Cores funcionais (`success`, `warning`, `danger`, `info`) são preservadas para status e feedback.
- Hex não deve ser espalhado em componentes: use tokens do Tailwind ou `hsl(var(--token))`.
- O gradiente de marca (`brand-gradient`, verde → ciano → roxo) é reservado a detalhes pontuais.

## Tipografia

- Família: **Inter**; números e dados técnicos podem usar **JetBrains Mono**.
- Títulos de página: 22px, semibold, `tracking-[-0.02em]`.
- Títulos de card/seção: `text-base`, semibold, tracking apertado.
- Labels: 13px, medium, `text-muted-foreground`.
- Texto de apoio: 14px (`text-sm`) e metadados 11–12px.
- Botões: 14px medium; botões pequenos 12px.
- Acentos e metadados podem usar `uppercase` com tracking entre `0.08em` e `0.18em`.

## Raios e elevação

| Token         | Valor | Uso                                      |
| ------------- | ----- | ---------------------------------------- |
| `radius-sm`   | 6px   | badges, tags, itens de menu               |
| `radius-md`   | 8px   | botões, inputs, selects, popovers         |
| `radius-lg`   | 16px  | cards, diálogos, sheets                   |
| `radius-xl`   | 20px  | blocos grandes e colunas do Kanban        |
| `rounded-full`| pill  | avatares, badges de status, indicadores   |

- Sombras: `shadow-xs` para detalhes, `shadow-card` para cards, `shadow-lg` para menus e
  `shadow-overlay` para diálogos/sheets.
- Não usar sombras coloridas fortes em superfícies grandes. O CTA primário tem brilho sutil.
- O overlay de modais usa `bg-slate-950/55` com blur leve.

## Componentes

### Botões
- Primário: gradiente vertical discreto (`primary` → `primary-strong`), texto escuro, brilho interno
  e sombra suave. Hover clareia levemente; active escurece.
- Secundário: fundo `secondary`. Outline: borda de input e hover esverdeado discreto.
- Ghost: sem borda, hover em `surface-hover`. Perigo: `danger` com texto contrastante.
- Alturas atuais devem ser mantidas (`h-9` padrão, `h-8` pequeno, `h-10` grande).

### Campos
- Inputs, textareas e selects: 36px de altura, raio 8px, borda `input`, fundo `surface`.
- Hover de borda sutil; foco com borda `primary/50` + anel `ring/20`.
- Estado inválido usa `danger`; desabilitado reduz opacidade e usa fundo `muted`.
- Placeholder é secundário; nunca usar placeholder como label.

### Cards, tabelas e listas
- Card: raio 16px, borda suavizada, `shadow-card`.
- Tabelas: cabeçalho em `muted/30`, texto 11px uppercase com tracking, linhas com divisória sutil.
- A densidade de linhas e a altura de células não devem aumentar.
- Evitar transformar listas operacionais em uma sequência de cards decorativos.

### Navegação
- Header: altura 56px, fundo translúcido com blur, divisória sutil.
- Sidebar: superfície própria, item ativo em `sidebar-accent` com texto primário e anel interno.
- Não alterar ordem, agrupamento ou localização dos itens por motivo estético.

### Modais, menus e feedback
- Diálogos e sheets: raio 16px, `shadow-overlay`, overlay com blur.
- Dropdowns, selects e popovers usam raio 8px e `shadow-lg`.
- Badges de status: pill, com ícone/ponto + texto; cor nunca é o único indicador.
- Loading usa skeleton ou spinner central; evitar animações longas ou deslocamentos de layout.

## Estados

| Estado     | Padrão                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Hover      | fundo `surface-hover` ou borda `primary/30`                            |
| Foco       | anel de 2px com `ring`, offset apenas quando necessário                |
| Selecionado| fundo `primary/10` ou `sidebar-accent`, texto primário, anel discreto  |
| Erro       | borda/texto `danger`, sem depender apenas de cor para comunicar        |
| Desabilitado | opacidade reduzida, cursor bloqueado, sem hover                      |
| Carregando | skeleton ou spinner, preservando o espaço do conteúdo                  |

## Temas e responsividade

- `light` é o padrão; `dark` espelha o canvas do login; `system` segue a preferência do sistema.
- Novos componentes devem funcionar nos dois temas e usar apenas tokens.
- Testar em desktop (1366×768), tablet (768px) e mobile (390px).
- O atendimento mantém lista, chat e painel de contato com rolagem independente e sem redução da
  área útil do chat.

## Faça / Não faça

**Faça**
- Reutilize tokens e componentes compartilhados.
- Prefira ajustes de estilo a reescrever componentes.
- Verifique tabelas, formulários, modais e navegação antes de alterar um primitivo.
- Preserve alturas, larguras e comportamentos existentes.

**Não faça**
- Introduzir novas cores sem necessidade.
- Usar gradientes fortes em fundos de trabalho.
- Aumentar paddings globalmente para “modernizar”.
- Reorganizar menus ou fluxos por estética.
- Alterar a identificação visual de mensagens recebidas/enviadas ou estados operacionais.

## Onde alterar

1. Tokens globais: `frontend/src/index.css`
2. Escalas do Tailwind: `frontend/tailwind.config.ts`
3. Primitivos: `frontend/src/components/ui/`
4. Componentes de composição: `frontend/src/components/common/`
5. Chrome da aplicação: `frontend/src/components/layout/`
6. Login: `frontend/src/features/auth/` (somente alinhamentos, sem mudança de fluxo)
