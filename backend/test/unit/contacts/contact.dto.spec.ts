import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  CreateContactDto,
  UpdateContactDto,
} from '../../../src/modules/contacts/dto/contact.dto.js';

const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function validatePayload<T extends object>(
  type: new () => T,
  payload: object,
): Promise<{ dto: T; errors: ValidationError[] }> {
  const dto = plainToInstance(type, payload);
  const errors = await validate(dto, VALIDATION_OPTIONS);
  return { dto, errors };
}

describe('Contact DTOs', () => {
  it('accepts birthDate and address when creating a contact', async () => {
    const { dto, errors } = await validatePayload(CreateContactDto, {
      name: 'Maria Silva',
      birthDate: '1990-02-28',
      address: 'Rua das Flores, 123',
    });

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      birthDate: '1990-02-28',
      address: 'Rua das Flores, 123',
    });
  });

  it('accepts null birthDate and address when updating a contact', async () => {
    const { dto, errors } = await validatePayload(UpdateContactDto, {
      birthDate: null,
      address: null,
    });

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ birthDate: null, address: null });
  });

  it('still rejects properties outside the contract', async () => {
    const { errors } = await validatePayload(CreateContactDto, {
      name: 'Maria Silva',
      unknownField: 'value',
    });

    expect(errors.some((error) => error.property === 'unknownField')).toBe(true);
  });

  it('rejects a birth date outside the expected format', async () => {
    const { errors } = await validatePayload(UpdateContactDto, {
      birthDate: '28/02/1990',
    });

    expect(errors.some((error) => error.property === 'birthDate')).toBe(true);
  });
});
