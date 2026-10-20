export interface ScheduledMessageVariables {
  nome: string;
  empresa: string;
  valor: string;
}

export function renderScheduledMessage(
  template: string,
  variables: ScheduledMessageVariables,
): string {
  return template.replace(
    /\{(nome|empresa|valor)\}/g,
    (_match, key: keyof ScheduledMessageVariables) => variables[key] ?? '',
  );
}
