import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from '@/lib/external-url';
import type { CustomMenuGroup } from '@/types/custom-menu';
import {
  createEmptyButtonDraft,
  createEmptyGroupDraft,
  toGroupDrafts,
  toSaveCustomMenuInput,
  validateCustomMenuGroups,
} from './custom-menu-utils';

const group: CustomMenuGroup = {
  id: 'group-1',
  name: 'Lojas',
  icon: 'store',
  active: true,
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  buttons: [
    {
      id: 'button-1',
      name: 'JP Peças',
      url: 'https://pecas.example.com',
      icon: 'external-link',
      active: true,
      position: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('isSafeExternalUrl', () => {
  it('accepts http and https URLs only', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('http://192.168.0.10:8080/sistema')).toBe(true);

    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,hello')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('ftp://example.com')).toBe(false);
    expect(isSafeExternalUrl('example.com')).toBe(false);
  });
});

describe('custom menu drafts', () => {
  it('maps server groups to drafts and back to the save payload', () => {
    const drafts = toGroupDrafts([group]);

    expect(drafts[0]).toMatchObject({
      key: 'group-1',
      id: 'group-1',
      name: 'Lojas',
      icon: 'store',
      active: true,
    });
    expect(drafts[0].buttons[0]).toMatchObject({
      key: 'button-1',
      id: 'button-1',
      name: 'JP Peças',
      url: 'https://pecas.example.com',
    });

    expect(toSaveCustomMenuInput(drafts)).toEqual({
      groups: [
        {
          id: 'group-1',
          name: 'Lojas',
          icon: 'store',
          active: true,
          buttons: [
            {
              id: 'button-1',
              name: 'JP Peças',
              url: 'https://pecas.example.com',
              icon: 'external-link',
              active: true,
            },
          ],
        },
      ],
    });
  });

  it('validates required names and safe URLs', () => {
    const emptyGroup = createEmptyGroupDraft();
    expect(validateCustomMenuGroups([emptyGroup])).toContain('nome do grupo');

    const groupWithButton = {
      ...emptyGroup,
      name: 'Lojas',
      buttons: [{ ...createEmptyButtonDraft(), name: 'Site', url: 'https://example.com' }],
    };
    expect(validateCustomMenuGroups([groupWithButton])).toBeNull();

    const unsafe = {
      ...groupWithButton,
      buttons: [{ ...groupWithButton.buttons[0], url: 'javascript:alert(1)' }],
    };
    expect(validateCustomMenuGroups([unsafe])).toContain('URL http(s) válida');
  });
});
