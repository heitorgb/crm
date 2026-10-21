export interface CustomMenuButton {
  id: string;
  name: string;
  url: string;
  icon: string | null;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomMenuGroup {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  buttons: CustomMenuButton[];
}

export interface CustomMenuResponse {
  groups: CustomMenuGroup[];
}

export interface CustomMenuButtonDraft {
  key: string;
  id?: string;
  name: string;
  url: string;
  icon: string | null;
  active: boolean;
}

export interface CustomMenuGroupDraft {
  key: string;
  id?: string;
  name: string;
  icon: string | null;
  active: boolean;
  buttons: CustomMenuButtonDraft[];
}

export interface SaveCustomMenuInput {
  groups: Array<{
    id?: string;
    name: string;
    icon: string | null;
    active: boolean;
    buttons: Array<{
      id?: string;
      name: string;
      url: string;
      icon: string | null;
      active: boolean;
    }>;
  }>;
}
