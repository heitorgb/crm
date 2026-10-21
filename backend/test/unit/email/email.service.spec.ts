import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.validation.js';
import {
  EmailDeliveryError,
  EmailNotConfiguredError,
} from '../../../src/infrastructure/email/email.errors.js';
import { EmailService } from '../../../src/infrastructure/email/email.service.js';

const { send, ResendMock } = vi.hoisted(() => {
  const send = vi.fn();
  class ResendMock {
    emails = { send };
  }
  return { send, ResendMock };
});

vi.mock('resend', () => ({ Resend: ResendMock }));

function createService(values: Record<string, string | undefined> = {}): EmailService {
  const config = {
    get: vi.fn((key: string) => values[key]),
  };
  return new EmailService(config as unknown as ConfigService<Env, true>);
}

describe('EmailService', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('sends a password reset e-mail with escaped data and the APP_URL link', async () => {
    send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const service = createService({
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'OrderUp CRM <noreply@mail.crm.orderup.com.br>',
      APP_URL: 'https://crm.example.com/',
    });
    const token = 'tok en&value';

    await service.sendPasswordResetEmail({
      to: 'ana@example.com',
      name: 'Ana <script>alert(1)</script>',
      token,
    });

    const payload = send.mock.calls[0][0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    };

    expect(payload.from).toBe('OrderUp CRM <noreply@mail.crm.orderup.com.br>');
    expect(payload.to).toBe('ana@example.com');
    expect(payload.subject).toContain('Redefina sua senha');
    expect(payload.html).toContain(
      'https://crm.example.com/redefinir-senha?token=tok%20en%26value',
    );
    expect(payload.html).toContain('Ana &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(payload.html).not.toContain('<script>');
    expect(payload.html).toContain('30 minutos');
    expect(payload.text).toContain('30 minutos');
    expect(payload.text).toContain('Se você não solicitou esta alteração');
  });

  it('fails safely when Resend rejects the send request or the network throws', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'invalid' } });
    const service = createService({
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'OrderUp CRM <noreply@mail.crm.orderup.com.br>',
      APP_URL: 'https://crm.example.com',
    });

    await expect(
      service.sendPasswordResetEmail({
        to: 'ana@example.com',
        name: 'Ana',
        token: 'secret-token',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof EmailDeliveryError && !error.message.includes('secret-token'),
    );
  });

  it('fails when configuration is missing or APP_URL is not http(s)', async () => {
    const missing = createService({
      RESEND_FROM_EMAIL: 'OrderUp CRM <noreply@mail.crm.orderup.com.br>',
      APP_URL: 'https://crm.example.com',
    });
    expect(() => missing.assertConfigured()).toThrow(EmailNotConfiguredError);

    const invalidUrl = createService({
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'OrderUp CRM <noreply@mail.crm.orderup.com.br>',
      APP_URL: 'javascript:alert(1)',
    });
    expect(() => invalidUrl.assertConfigured()).toThrow(EmailNotConfiguredError);

    await expect(
      missing.sendPasswordResetEmail({ to: 'ana@example.com', name: 'Ana', token: 'token' }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(send).not.toHaveBeenCalled();
  });

  it('maps network failures to a safe delivery error without leaking the token', async () => {
    send.mockRejectedValue(new Error('socket hang up secret-token'));
    const service = createService({
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'OrderUp CRM <noreply@mail.crm.orderup.com.br>',
      APP_URL: 'https://crm.example.com',
    });

    await expect(
      service.sendPasswordResetEmail({
        to: 'ana@example.com',
        name: 'Ana',
        token: 'secret-token',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof EmailDeliveryError && !error.message.includes('secret-token'),
    );
  });
});
