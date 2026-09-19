# ADR-001 — Monólito modular como estilo arquitetural inicial

- **Status:** Aceito
- **Data:** 2026-09-19
- **Decisores:** Time OrderUp CRM
- **Substitui:** —

## Contexto

O OrderUp CRM é um produto multi-tenant em estágio inicial, com três desenvolvedores e um escopo
que ainda vai evoluir (atendimento/WhatsApp, pipeline comercial, tarefas, automações). Precisamos
de velocidade de entrega, fronteiras internas claras e baixo custo operacional, sem fechar portas
para crescimento futuro.

## Decisão

Adotar um **monólito modular**: um único deploy, com módulos de negócio bem delimitados
(`src/modules/*`), separação de cross-cutting (`src/common`), configuração (`src/config`) e
infraestrutura (`src/infrastructure`). As dependências apontam para dentro e módulos de negócio não
se acoplam ciclicamente.

## Motivos

- **Simplicidade operacional:** um artefato para build, deploy, logs e debug.
- **Consistência transacional:** operações de negócio cruzam domínios e se beneficiam de
  transações locais em um banco.
- **Velocidade:** um repositório, uma pipeline, um ambiente — importante para um time pequeno.
- **Evolução incremental:** fronteiras internas permitem extrair um módulo depois, se necessário.
- **Custo:** sem overhead de rede, service discovery, tracing distribuído prematuro.

## Benefícios

- Refatoração e reuso direto de código entre módulos.
- Testes de integração simples (uma aplicação, um banco).
- Curva de aprendizado menor para novos integrantes.
- Observabilidade unificada (logging estruturado, requestId).

## Limitações

- Um deploy exige cuidado para não acoplar releases de módulos distintos.
- Escala é horizontal por **réplica inteira** da aplicação, não por módulo.
- Fronteiras precisam de disciplina; sem regras, o monólito vira "big ball of mud".
- Um bug crítico pode afetar toda a aplicação.

## Alternativa considerada: microserviços

Microserviços trazem escalabilidade independente, isolamento de falhas e autonomia de times. Porém,
para o estágio atual, introduzem custos desproporcionais:

- complexidade operacional (deploy, rede, service discovery, mensageria);
- consistência eventual onde transações locais bastariam;
- sobrecarga de observabilidade e debugging distribuído;
- necessidade de contratos/versionamento e infraestrutura de mensageria;
- menor velocidade de entrega com time pequeno.

**Decisão:** não usar microserviços agora.

## Condições que poderiam justificar separação futura

A extração de um módulo para serviço separado só deve ser avaliada com evidência concreta, por
exemplo:

- necessidade real de **escala independente** de um domínio específico;
- **perfil de carga/ciclo de vida** muito distinto (ex.: workers de integração/IA);
- **isolamento de falhas** exigido por requisito de negócio;
- **autonomia de time** com ownership claro e comunicação estável;
- gargalo de deploy/velocidade comprovado pelo monólito.

Até lá, mantemos o monólito modular e, se necessário, **workers separados do processo HTTP** usando
o mesmo código-base antes de considerar um serviço autônomo.

## Consequências

- Toda decisão de módulo deve respeitar as fronteiras definidas em `AGENTS.md`.
- Revisões devem rejeitar imports cíclicos entre módulos de negócio.
- Caso a separação futura ocorra, contratos e dados por módulo já estarão mais claros.
