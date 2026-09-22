import { useMemo, useState } from 'react';
import { Bot, FileText, Plus, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { FormField } from '@/components/common/form-field';
import { PageHeader } from '@/components/common/page-header';
import { PageLoader } from '@/components/common/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type {
  DataSensitivityLevel,
  QualificationProfile,
  QualificationProfileDraft,
} from '@/types/qualification';
import { ProfileItemsField, type EditableProfileItem } from './profile-items-field';
import {
  useCreateQualificationProfile,
  useDeleteQualificationProfile,
  useQualificationProfiles,
  useUpdateQualificationProfile,
} from './queries';

const NEW_PROFILE_KEY = '__new__';

const toneOptions = ['Amigável', 'Consultivo', 'Formal', 'Direto'];

const sensitivityOptions: { value: DataSensitivityLevel; label: string; description: string }[] = [
  { value: 'low', label: 'Baixo', description: 'Dados comuns. Decisões automáticas liberadas.' },
  { value: 'medium', label: 'Médio', description: 'Requer atenção à revisão de decisões.' },
  { value: 'high', label: 'Alto', description: 'Recomenda revisão humana antes de desqualificar.' },
];

function emptyDraft(): QualificationProfileDraft {
  return {
    name: '',
    description: null,
    businessContext: null,
    botName: null,
    initialMessage: null,
    privacyNoticeText: null,
    tone: null,
    objective: null,
    requiredInformation: [],
    qualificationCriteria: [],
    disqualificationCriteria: [],
    completionCriteria: [],
    customInstructions: null,
    qualifiedMessage: null,
    disqualifiedMessage: null,
    needsHumanMessage: null,
    humanHandoffRules: [],
    qualificationLevels: [],
    dataSensitivityLevel: 'low',
    isDefault: false,
    active: true,
  };
}

function fromProfile(profile: QualificationProfile): QualificationProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    businessContext: profile.businessContext,
    botName: profile.botName,
    initialMessage: profile.initialMessage,
    privacyNoticeText: profile.privacyNoticeText,
    tone: profile.tone,
    objective: profile.objective,
    requiredInformation: profile.requiredInformation,
    qualificationCriteria: profile.qualificationCriteria,
    disqualificationCriteria: profile.disqualificationCriteria,
    completionCriteria: profile.completionCriteria,
    customInstructions: profile.customInstructions,
    qualifiedMessage: profile.qualifiedMessage,
    disqualifiedMessage: profile.disqualifiedMessage,
    needsHumanMessage: profile.needsHumanMessage,
    humanHandoffRules: profile.humanHandoffRules,
    qualificationLevels: profile.qualificationLevels,
    dataSensitivityLevel: profile.dataSensitivityLevel,
    isDefault: profile.isDefault,
    active: profile.active,
  };
}

function itemsAreValid(items: EditableProfileItem[]): boolean {
  return items.every((item) => item.key.trim().length > 0 && item.label.trim().length > 0);
}

export function QualificationBotPage() {
  const query = useQualificationProfiles({ perPage: 100, sort: 'createdAt', order: 'asc' });

  const profiles = useMemo(() => query.data?.data ?? [], [query.data]);
  const [explicitId, setExplicitId] = useState<string | undefined>(undefined);

  const selectedId =
    explicitId !== undefined
      ? explicitId === NEW_PROFILE_KEY
        ? null
        : explicitId
      : (profiles.find((profile) => profile.isDefault && profile.active)?.id ??
        profiles[0]?.id ??
        null);
  const selectedProfile = profiles.find((profile) => profile.id === selectedId) ?? null;

  if (query.isPending) {
    return <PageLoader label="Carregando perfis de qualificação…" />;
  }

  if (query.isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Bot e Qualificação" />
        <EmptyState
          icon={Bot}
          title="Não foi possível carregar os perfis"
          description="Verifique a conexão com a API e tente novamente."
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      </div>
    );
  }

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

      <QualificationProfileEditor
        key={selectedId ?? NEW_PROFILE_KEY}
        profiles={profiles}
        selectedId={selectedId}
        selectedProfile={selectedProfile}
        onSelect={(id) => setExplicitId(id)}
        onNew={() => setExplicitId(NEW_PROFILE_KEY)}
        onResetSelection={() => setExplicitId(undefined)}
      />
    </div>
  );
}

interface QualificationProfileEditorProps {
  profiles: QualificationProfile[];
  selectedId: string | null;
  selectedProfile: QualificationProfile | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onResetSelection: () => void;
}

function QualificationProfileEditor({
  profiles,
  selectedId,
  selectedProfile,
  onSelect,
  onNew,
  onResetSelection,
}: QualificationProfileEditorProps) {
  const canWrite = useAuthStore((state) => state.hasRole('OWNER', 'ADMIN'));

  const createProfile = useCreateQualificationProfile();
  const updateProfile = useUpdateQualificationProfile();
  const deleteProfile = useDeleteQualificationProfile();

  const [draft, setDraft] = useState<QualificationProfileDraft>(
    selectedProfile ? fromProfile(selectedProfile) : emptyDraft(),
  );
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const readOnly = !canWrite;
  const pending = createProfile.isPending || updateProfile.isPending;

  const update = (patch: Partial<QualificationProfileDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const handleSave = async (): Promise<void> => {
    if (readOnly) {
      return;
    }
    if (draft.name.trim().length === 0) {
      setFeedback({ tone: 'danger', message: 'Informe o nome do perfil.' });
      return;
    }

    const arrays = [
      draft.requiredInformation,
      draft.qualificationCriteria,
      draft.disqualificationCriteria,
      draft.completionCriteria,
      draft.humanHandoffRules,
      draft.qualificationLevels,
    ];
    if (!arrays.every((items) => itemsAreValid(items as EditableProfileItem[]))) {
      setFeedback({ tone: 'danger', message: 'Preencha chave e rótulo de todos os itens.' });
      return;
    }

    const input = { ...draft, name: draft.name.trim() };

    try {
      if (selectedId) {
        const saved = await updateProfile.mutateAsync({ id: selectedId, input });
        setDraft(fromProfile(saved));
      } else {
        const saved = await createProfile.mutateAsync(input);
        onSelect(saved.id);
      }
      setFeedback({ tone: 'success', message: 'Perfil salvo com sucesso.' });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: error instanceof ApiError ? error.message : 'Não foi possível salvar o perfil.',
      });
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!selectedId) {
      return;
    }
    await deleteProfile.mutateAsync(selectedId);
    setConfirmDelete(false);
    onResetSelection();
  };

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <FormField id="profile-select" label="Perfil" className="flex-1">
            <Select
              value={selectedId ?? ''}
              onValueChange={onSelect}
              disabled={profiles.length === 0}
            >
              <SelectTrigger id="profile-select">
                <SelectValue placeholder="Selecione um perfil" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.isDefault ? ' · padrão' : ''}
                    {profile.active ? '' : ' · inativo'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onNew} disabled={readOnly}>
              <Plus />
              Novo perfil
            </Button>
            <Button onClick={() => void handleSave()} disabled={readOnly || pending}>
              <Save />
              Salvar
            </Button>
            {selectedId ? (
              <Button
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                disabled={readOnly || deleteProfile.isPending}
              >
                <Trash2 />
                Excluir
              </Button>
            ) : null}
          </div>
        </div>

        {selectedProfile ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Versão {selectedProfile.version}</span>
            <label className="flex items-center gap-2">
              <Switch
                checked={draft.active}
                onCheckedChange={(checked) =>
                  update({ active: checked, ...(checked ? {} : { isDefault: false }) })
                }
                disabled={readOnly}
              />
              Ativo
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={draft.isDefault}
                onCheckedChange={(checked) => update({ isDefault: checked })}
                disabled={readOnly || !draft.active}
              />
              Perfil padrão
            </label>
            <span className="hidden sm:inline">Somente um perfil padrão ativo por organização.</span>
          </div>
        ) : null}

        {feedback ? (
          <p
            className={
              feedback.tone === 'success'
                ? 'mt-3 text-xs font-medium text-success'
                : 'mt-3 text-xs font-medium text-danger'
            }
          >
            {feedback.message}
          </p>
        ) : null}
      </Card>

      {!selectedProfile && profiles.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="Nenhum perfil configurado"
          description="Crie um perfil para definir contexto, perguntas e critérios de qualificação do bot."
          action={
            <Button onClick={onNew} disabled={readOnly}>
              <Plus />
              Criar perfil
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="identity">
          <TabsList className="flex-wrap">
            <TabsTrigger value="identity">Identidade</TabsTrigger>
            <TabsTrigger value="context">Contexto</TabsTrigger>
            <TabsTrigger value="collection">Coleta</TabsTrigger>
            <TabsTrigger value="criteria">Critérios</TabsTrigger>
            <TabsTrigger value="closing">Encerramento</TabsTrigger>
            <TabsTrigger value="privacy">Privacidade</TabsTrigger>
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
                <FormField id="profile-name" label="Nome do perfil" required>
                  <Input
                    id="profile-name"
                    value={draft.name}
                    onChange={(event) => update({ name: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField id="profile-bot-name" label="Nome do bot">
                  <Input
                    id="profile-bot-name"
                    value={draft.botName ?? ''}
                    onChange={(event) => update({ botName: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField id="profile-description" label="Descrição" className="md:col-span-2">
                  <Input
                    id="profile-description"
                    value={draft.description ?? ''}
                    onChange={(event) => update({ description: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField
                  id="profile-initial-message"
                  label="Mensagem inicial"
                  className="md:col-span-2"
                >
                  <Textarea
                    id="profile-initial-message"
                    rows={3}
                    value={draft.initialMessage ?? ''}
                    onChange={(event) => update({ initialMessage: event.target.value })}
                    disabled={readOnly}
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
                <FormField id="profile-business-context" label="Contexto do negócio">
                  <Textarea
                    id="profile-business-context"
                    rows={3}
                    value={draft.businessContext ?? ''}
                    onChange={(event) => update({ businessContext: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField id="profile-objective" label="Objetivo da qualificação">
                  <Textarea
                    id="profile-objective"
                    rows={3}
                    value={draft.objective ?? ''}
                    onChange={(event) => update({ objective: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField id="profile-tone" label="Tom de comunicação" className="max-w-xs">
                  <Select
                    value={draft.tone ?? ''}
                    onValueChange={(tone) => update({ tone })}
                    disabled={readOnly}
                  >
                    <SelectTrigger id="profile-tone">
                      <SelectValue placeholder="Selecione" />
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
                <FormField
                  id="profile-custom-instructions"
                  label="Instruções adicionais"
                  description="Orientações específicas do seu negócio para o bot."
                >
                  <Textarea
                    id="profile-custom-instructions"
                    rows={3}
                    value={draft.customInstructions ?? ''}
                    onChange={(event) => update({ customInstructions: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="collection">
            <Card>
              <CardHeader>
                <CardTitle>Informações a coletar</CardTitle>
              </CardHeader>
              <CardContent>
                <ProfileItemsField
                  items={draft.requiredInformation as EditableProfileItem[]}
                  onChange={(items) => update({ requiredInformation: items })}
                  disabled={readOnly}
                  showRequired
                  addLabel="Adicionar informação"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="criteria">
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Critérios de qualificação</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProfileItemsField
                    items={draft.qualificationCriteria as EditableProfileItem[]}
                    onChange={(items) => update({ qualificationCriteria: items })}
                    disabled={readOnly}
                    showWeight
                    addLabel="Adicionar critério"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Critérios de desqualificação</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProfileItemsField
                    items={draft.disqualificationCriteria as EditableProfileItem[]}
                    onChange={(items) => update({ disqualificationCriteria: items })}
                    disabled={readOnly}
                    addLabel="Adicionar critério"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Níveis de qualificação</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProfileItemsField
                    items={draft.qualificationLevels as EditableProfileItem[]}
                    onChange={(items) => update({ qualificationLevels: items })}
                    disabled={readOnly}
                    addLabel="Adicionar nível"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Critérios de conclusão</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProfileItemsField
                    items={draft.completionCriteria as EditableProfileItem[]}
                    onChange={(items) => update({ completionCriteria: items })}
                    disabled={readOnly}
                    addLabel="Adicionar condição"
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="closing">
            <Card>
              <CardHeader>
                <CardTitle>Mensagens e handoff</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FormField
                  id="profile-qualified-message"
                  label="Mensagem de qualificado"
                  description="Aceita variáveis, ex.: {{criterioNaoAtendido}}."
                >
                  <Textarea
                    id="profile-qualified-message"
                    rows={2}
                    value={draft.qualifiedMessage ?? ''}
                    onChange={(event) => update({ qualifiedMessage: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField
                  id="profile-disqualified-message"
                  label="Mensagem de desqualificado"
                  description="Cite o critério não atendido, ex.: {{criterioNaoAtendido}}."
                >
                  <Textarea
                    id="profile-disqualified-message"
                    rows={2}
                    value={draft.disqualifiedMessage ?? ''}
                    onChange={(event) => update({ disqualifiedMessage: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField id="profile-needs-human-message" label="Mensagem de atendimento humano">
                  <Textarea
                    id="profile-needs-human-message"
                    rows={2}
                    value={draft.needsHumanMessage ?? ''}
                    onChange={(event) => update({ needsHumanMessage: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <div className="space-y-2">
                  <Label>Regras de handoff para humano</Label>
                  <ProfileItemsField
                    items={draft.humanHandoffRules as EditableProfileItem[]}
                    onChange={(items) => update({ humanHandoffRules: items })}
                    disabled={readOnly}
                    addLabel="Adicionar regra"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="privacy">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" aria-hidden />
                  Privacidade e governança
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FormField
                  id="profile-privacy-notice"
                  label="Aviso de privacidade"
                  description="Enviado no primeiro contato. Se ficar vazio com o perfil ativo, um texto padrão do sistema é usado."
                >
                  <Textarea
                    id="profile-privacy-notice"
                    rows={4}
                    value={draft.privacyNoticeText ?? ''}
                    onChange={(event) => update({ privacyNoticeText: event.target.value })}
                    disabled={readOnly}
                  />
                </FormField>
                <FormField
                  id="profile-sensitivity"
                  label="Sensibilidade dos dados"
                  description="Define se decisões automáticas de desqualificação precisam de revisão humana."
                  className="max-w-md"
                >
                  <Select
                    value={draft.dataSensitivityLevel}
                    onValueChange={(value) =>
                      update({ dataSensitivityLevel: value as DataSensitivityLevel })
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger id="profile-sensitivity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sensitivityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info/5 p-3 text-xs text-muted-foreground">
                  <FileText className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                  <p>
                    As instruções deste perfil são configuração de negócio do tenant. Nenhuma chave de
                    API é armazenada aqui.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir perfil"
        description="Sessões e análises futuras que referenciarem este perfil não poderão recuperá-lo."
        confirmLabel="Excluir"
        destructive
        loading={deleteProfile.isPending}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
