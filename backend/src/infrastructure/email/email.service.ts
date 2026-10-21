import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../../config/env.validation.js';
import { EmailDeliveryError, EmailNotConfiguredError } from './email.errors.js';

interface PasswordResetEmailInput {
  to: string;
  name: string;
  token: string;
}

interface EmailConfiguration {
  apiKey: string;
  from: string;
  appUrl: string;
}

const RESET_PASSWORD_PATH = '/redefinir-senha';

@Injectable()
export class EmailService {
  private client?: Resend;

  constructor(private readonly config: ConfigService<Env, true>) {
    const apiKey = this.config.get('RESEND_API_KEY');
    if (apiKey) {
      this.client = new Resend(apiKey);
    }
  }

  assertConfigured(): EmailConfiguration {
    const configuration = this.configuration();
    if (!configuration) {
      throw new EmailNotConfiguredError();
    }
    return configuration;
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    const configuration = this.assertConfigured();
    const resetUrl = buildResetUrl(configuration.appUrl, input.token);
    const safeName = escapeHtml(input.name.trim() || 'olá');
    const safeResetUrl = escapeHtml(resetUrl);

    let response: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      response = await this.client!.emails.send({
        from: configuration.from,
        to: input.to,
        subject: 'Redefina sua senha — OrderUp CRM',
        html: passwordResetHtml(safeName, safeResetUrl),
        text: [
          `Olá, ${input.name.trim() || 'tudo bem'}!`,
          '',
          'Recebemos uma solicitação para redefinir a senha da sua conta no OrderUp CRM.',
          'Acesse o link abaixo para criar uma nova senha:',
          resetUrl,
          '',
          'Este link é válido por 30 minutos e só pode ser usado uma vez.',
          'Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual continua válida.',
          '',
          'OrderUp CRM',
        ].join('\n'),
      });
    } catch {
      throw new EmailDeliveryError();
    }

    if (response.error) {
      throw new EmailDeliveryError();
    }
  }

  private configuration(): EmailConfiguration | null {
    const apiKey = this.config.get('RESEND_API_KEY');
    const from = this.config.get('RESEND_FROM_EMAIL');
    const appUrl = this.config.get('APP_URL');

    if (!apiKey || !from || !appUrl || !this.client) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(appUrl);
    } catch {
      return null;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    return { apiKey, from, appUrl: appUrl.replace(/\/+$/, '') };
  }
}

function buildResetUrl(appUrl: string, token: string): string {
  return `${appUrl}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function passwordResetHtml(name: string, resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Redefina sua senha — OrderUp CRM</title>
  </head>
  <body style="margin:0;padding:0;background:#070a12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070a12;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#11151f;border:1px solid #232937;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:44px;height:44px;border-radius:12px;background:#22c55e;color:#052e16;font-size:18px;font-weight:800;text-align:center;vertical-align:middle;">O</td>
                    <td style="padding-left:12px;">
                      <p style="margin:0;font-size:16px;font-weight:700;color:#f4f6fa;">OrderUp CRM</p>
                      <p style="margin:2px 0 0;font-size:12px;color:#98a2b7;">Atendimento omnichannel</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;">
                <h1 style="margin:0;font-size:22px;line-height:1.3;color:#f4f6fa;">Redefina sua senha</h1>
                <p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#c8cede;">
                  Olá, <strong style="color:#f4f6fa;">${name}</strong>. Recebemos uma solicitação para redefinir a senha da sua conta no OrderUp CRM.
                </p>
                <p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#c8cede;">
                  Clique no botão abaixo para criar uma nova senha. Este link é válido por <strong style="color:#f4f6fa;">30 minutos</strong> e só pode ser usado uma vez.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background:#22c55e;">
                      <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#052e16;text-decoration:none;">Redefinir minha senha</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#98a2b7;">Se o botão não funcionar, copie e cole o link abaixo no navegador:</p>
                <p style="margin:8px 0 0;font-size:12px;line-height:1.6;word-break:break-all;color:#86efac;">${resetUrl}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#98a2b7;">
                  Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual continua válida.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;">
                <div style="border-top:1px solid #232937;padding-top:20px;font-size:11px;line-height:1.6;color:#6f7a90;">
                  Esta é uma mensagem automática do OrderUp CRM. Não responda a este e-mail.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
