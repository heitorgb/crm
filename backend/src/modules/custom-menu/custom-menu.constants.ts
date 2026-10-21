export const CUSTOM_MENU_ICON_KEYS = [
  'store',
  'globe',
  'smartphone',
  'wrench',
  'briefcase',
  'users',
  'building',
  'shopping-cart',
  'package',
  'boxes',
  'network',
  'link',
  'layout-grid',
  'folder',
  'app-window',
  'cloud',
  'server',
  'puzzle',
  'rocket',
  'plug',
  'chart-bar',
  'external-link',
  'file-text',
  'calendar',
  'message-circle',
  'headset',
  'receipt',
  'tag',
  'search',
  'shield',
  'database',
  'star',
] as const;

export type CustomMenuIconKey = (typeof CUSTOM_MENU_ICON_KEYS)[number];

export const MAX_CUSTOM_MENU_GROUPS = 50;
export const MAX_CUSTOM_MENU_BUTTONS_PER_GROUP = 50;
