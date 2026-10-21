import { isSafeExternalUrl } from '@/lib/external-url';
import type {
  CustomMenuButtonDraft,
  CustomMenuGroup,
  CustomMenuGroupDraft,
  SaveCustomMenuInput,
} from '@/types/custom-menu';

export const MAX_CUSTOM_MENU_GROUPS = 50;
export const MAX_CUSTOM_MENU_BUTTONS_PER_GROUP = 50;

let localKeyCounter = 0;

export function createLocalKey(prefix: string): string {
  localKeyCounter += 1;
  return `${prefix}-${Date.now()}-${localKeyCounter}`;
}

export function createEmptyGroupDraft(): CustomMenuGroupDraft {
  return {
    key: createLocalKey('group'),
    name: '',
    icon: null,
    active: true,
    buttons: [],
  };
}

export function createEmptyButtonDraft(): CustomMenuButtonDraft {
  return {
    key: createLocalKey('button'),
    name: '',
    url: '',
    icon: null,
    active: true,
  };
}

export function toGroupDrafts(groups: CustomMenuGroup[]): CustomMenuGroupDraft[] {
  return groups.map((group) => ({
    key: group.id,
    id: group.id,
    name: group.name,
    icon: group.icon,
    active: group.active,
    buttons: group.buttons.map((button) => ({
      key: button.id,
      id: button.id,
      name: button.name,
      url: button.url,
      icon: button.icon,
      active: button.active,
    })),
  }));
}

export function cloneGroupDraft(group: CustomMenuGroupDraft): CustomMenuGroupDraft {
  return {
    ...group,
    buttons: group.buttons.map((button) => ({ ...button })),
  };
}

export function validateCustomMenuGroups(groups: CustomMenuGroupDraft[]): string | null {
  if (groups.length > MAX_CUSTOM_MENU_GROUPS) {
    return `Cadastre no máximo ${MAX_CUSTOM_MENU_GROUPS} grupos.`;
  }

  for (const [groupIndex, group] of groups.entries()) {
    if (group.name.trim().length === 0) {
      return `Informe o nome do grupo ${groupIndex + 1}.`;
    }

    if (group.buttons.length > MAX_CUSTOM_MENU_BUTTONS_PER_GROUP) {
      return `O grupo "${group.name.trim()}" pode ter no máximo ${MAX_CUSTOM_MENU_BUTTONS_PER_GROUP} botões.`;
    }

    for (const [buttonIndex, button] of group.buttons.entries()) {
      if (button.name.trim().length === 0) {
        return `Informe o nome do botão ${buttonIndex + 1} do grupo "${group.name.trim()}".`;
      }

      if (!isSafeExternalUrl(button.url)) {
        return `Informe uma URL http(s) válida para o botão "${button.name.trim()}".`;
      }
    }
  }

  return null;
}

export function toSaveCustomMenuInput(groups: CustomMenuGroupDraft[]): SaveCustomMenuInput {
  return {
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name.trim(),
      icon: group.icon,
      active: group.active,
      buttons: group.buttons.map((button) => ({
        id: button.id,
        name: button.name.trim(),
        url: button.url.trim(),
        icon: button.icon,
        active: button.active,
      })),
    })),
  };
}
