import 'reflect-metadata';
import { ROLES_KEY } from '../../../src/modules/auth/auth.constants.js';
import { ScheduledMessagesController } from '../../../src/modules/scheduled-messages/scheduled-messages.controller.js';

describe('ScheduledMessagesController permissions', () => {
  it('requires OWNER or ADMIN to finalize a recurrence', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ScheduledMessagesController.prototype.cancel)).toEqual([
      'OWNER',
      'ADMIN',
    ]);
  });

  it('requires OWNER or ADMIN to create, edit, duplicate and retry schedules', () => {
    for (const method of ['create', 'update', 'duplicate', 'retry'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, ScheduledMessagesController.prototype[method])).toEqual(
        ['OWNER', 'ADMIN'],
      );
    }
  });

  it('does not require management roles to read schedules and logs', () => {
    for (const method of ['list', 'findOne', 'logs', 'recipients'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, ScheduledMessagesController.prototype[method]),
      ).toBeUndefined();
    }
  });
});
