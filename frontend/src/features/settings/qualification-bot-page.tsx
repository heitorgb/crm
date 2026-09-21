import { useState } from 'react';
import { Bot, Info, Plus, Sparkles, X } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface BotConfig {
  botName: string;
  greeting: string;
  businessContext: string;
  goal: string;
  tone: string;
  requiredFields: string[];
  qualificationCriteria: string;
  disqualificationCriteria: string;
  stopConditions: string;
  closingMessage: string;
  handoffRule: string;
}

const toneOptions = ['Amigável', 'Consultivo', 'Formal', 'Direto'];
const handoffOptions = [
  'Sempre que o lead pedir um humano',
  'Somente quando a qualificação falhar',
  'Quando o score for baixo',
  'Nunca (entrega apenas no resumo)',
];

export function QualificationBotPage() {
  const [config, setConfig] = useState<BotConfig>({
    botName: 'Assistente OrderUp',
    greeting: 'Olá! Sou o assistente da OrderUp. Posso fazer algumas perguntas rápidas para te ajudar?',
    businessContext:
      'Somos uma software house que desenvolve sistemas sob medida, automações e integrações para empresas.',
    goal: 'Entender a necessidade, o orçamento e o prazo para encaminhar ao time comercial.',
    tone: 'Consultivo',
    requiredFields: ['Segmento', 'Tamanho da empresa', 'Orçamento', 'Prazo', 'Decisor'],
    qualificationCriteria:
      'Orçamento compatível, necessidade clara e decisor presente na conversa.',
    disqualificationCriteria: 'Busca apenas informação gratuita ou fora da área de atuação.',
    stopConditions:
      'Encerrar quando todas as informações essenciais forem coletadas ou após 8 perguntas.',
    closingMessage: 'Perfeito! Vou registrar suas informações e o time entra em contato em breve.',
    handoffRule: handoffOptions[0],
  });
  const [fieldDraft, setFieldDraft] = useState('');

  const update = (patch: Partial<BotConfig>): void => setConfig((current) => ({ ...current, ...patch }));

  const addField = (): void => {
    const value = fieldDraft.trim();
    if (!value || config.requiredFields.includes(value)) {
      return;
    }
    update({ requiredFields: [...config.requiredFields, value] });
    setFieldDraft('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bot e Qualificação"
        description="Configure como o bot conversa e quais critérios usa para qualificar leads."
        actions={
          <Badge variant="info" className="gap-1">
            <Sparkles aria-hidden />
            Assistido por IA
          </Badge>
        }
      />

      <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info/5 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
        <p>
          Fundação visual da configuração. A edição será persistida no perfil de qualificação do
          tenant em uma fase futura — nenhum texto técnico de prompt é exigido do usuário.
        </p>
      </div>

      <Tabs defaultValue="identity">
        <TabsList className="flex-wrap">
          <TabsTrigger value="identity">Identidade</TabsTrigger>
          <TabsTrigger value="context">Contexto e objetivo</TabsTrigger>
          <TabsTrigger value="collection">Coleta</TabsTrigger>
          <TabsTrigger value="criteria">Critérios</TabsTrigger>
          <TabsTrigger value="closing">Encerramento e handoff</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-primary" aria-hidden />
                Identidade do bot
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FormField id="bot-name" label="Nome do bot" required>
                <Input
                  id="bot-name"
                  value={config.botName}
                  onChange={(event) => update({ botName: event.target.value })}
                />
              </FormField>
              <FormField
                id="greeting"
                label="Mensagem inicial"
                description="Primeira mensagem enviada ao lead."
              >
                <Textarea
                  id="greeting"
                  rows={3}
                  value={config.greeting}
                  onChange={(event) => update({ greeting: event.target.value })}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context">
          <Card>
            <CardHeader>
              <CardTitle>Contexto do negócio</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField id="business-context" label="Contexto do negócio">
                <Textarea
                  id="business-context"
                  rows={3}
                  value={config.businessContext}
                  onChange={(event) => update({ businessContext: event.target.value })}
                />
              </FormField>
              <FormField id="goal" label="Objetivo da qualificação">
                <Textarea
                  id="goal"
                  rows={3}
                  value={config.goal}
                  onChange={(event) => update({ goal: event.target.value })}
                />
              </FormField>
              <FormField id="tone" label="Tom de comunicação" className="max-w-xs">
                <Select value={config.tone} onValueChange={(tone) => update({ tone })}>
                  <SelectTrigger id="tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {toneOptions.map((tone) => (
                      <SelectItem key={tone} value={tone}>
                        {tone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collection">
          <Card>
            <CardHeader>
              <CardTitle>Informações que devem ser coletadas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {config.requiredFields.map((field) => (
                  <span
                    key={field}
                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-2 py-1 text-xs"
                  >
                    {field}
                    <button
                      type="button"
                      onClick={() =>
                        update({ requiredFields: config.requiredFields.filter((item) => item !== field) })
                      }
                      className="text-muted-foreground hover:text-danger"
                      aria-label={`Remover ${field}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {config.requiredFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma informação configurada.</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Input
                  value={fieldDraft}
                  onChange={(event) => setFieldDraft(event.target.value)}
                  placeholder="Ex.: Volume mensal de pedidos"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addField();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addField}>
                  <Plus />
                  Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="criteria">
          <Card>
            <CardHeader>
              <CardTitle>Critérios de qualificação</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FormField id="qual-criteria" label="Critérios de qualificação">
                <Textarea
                  id="qual-criteria"
                  rows={5}
                  value={config.qualificationCriteria}
                  onChange={(event) => update({ qualificationCriteria: event.target.value })}
                />
              </FormField>
              <FormField id="disqual-criteria" label="Critérios de desqualificação">
                <Textarea
                  id="disqual-criteria"
                  rows={5}
                  value={config.disqualificationCriteria}
                  onChange={(event) => update({ disqualificationCriteria: event.target.value })}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="closing">
          <Card>
            <CardHeader>
              <CardTitle>Encerramento e handoff</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                id="stop-conditions"
                label="Condições para encerrar a qualificação"
                description="Quando o bot deve parar de perguntar."
              >
                <Textarea
                  id="stop-conditions"
                  rows={3}
                  value={config.stopConditions}
                  onChange={(event) => update({ stopConditions: event.target.value })}
                />
              </FormField>
              <FormField id="closing-message" label="Mensagem de conclusão">
                <Textarea
                  id="closing-message"
                  rows={2}
                  value={config.closingMessage}
                  onChange={(event) => update({ closingMessage: event.target.value })}
                />
              </FormField>
              <FormField
                id="handoff-rule"
                label="Regras de handoff para humano"
                className="max-w-md"
              >
                <Select value={config.handoffRule} onValueChange={(handoffRule) => update({ handoffRule })}>
                  <SelectTrigger id="handoff-rule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {handoffOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button disabled title="Disponível quando o módulo de qualificação do tenant for implementado">
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}
