import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { AuthShell } from './auth-shell';
import { authFieldClasses, authLabelClasses, authLinkClasses, authSubmitClasses } from './auth-styles';
import { useForgotPassword } from './queries';

const GENERIC_MESSAGE =
  'Se existir uma conta associada a esse e-mail, você receberá as instruções para redefinir sua senha.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const forgotPassword = useForgotPassword();

  const requestError =
    forgotPassword.error instanceof ApiError
      ? forgotPassword.error.message
      : forgotPassword.error
        ? 'Não foi possível processar sua solicitação. Tente novamente.'
        : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setValidationError('Informe um e-mail válido.');
      return;
    }

    setValidationError(null);
    forgotPassword.mutate({ email: normalizedEmail });
  };

  if (forgotPassword.isSuccess) {
    return (
      <AuthShell
        badge={
          <>
            <CheckCircle2 className="size-3" aria-hidden="true" />
            Solicitação enviada
          </>
        }
        title="Verifique seu e-mail"
        description="Se os dados informados estiverem corretos, as instruções chegarão em instantes."
      >
        <div className="space-y-6">
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-4 py-3.5 text-sm leading-relaxed text-emerald-100"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{forgotPassword.data?.message ?? GENERIC_MESSAGE}</span>
          </div>

          <p className="text-xs leading-relaxed text-[var(--auth-muted)]">
            Não esqueça de verificar a caixa de spam. O link é válido por 30 minutos e só pode ser
            usado uma vez.
          </p>

          <Button asChild className={authSubmitClasses}>
            <Link to="/login">
              Voltar para o login
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      badge={
        <>
          <KeyRound className="size-3" aria-hidden="true" />
          Recuperação de acesso
        </>
      }
      title="Recuperar senha"
      description="Informe o e-mail da sua conta e enviaremos um link para você criar uma nova senha."
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="forgot-email" className={authLabelClasses}>
            E-mail
          </Label>
          <div className="group relative">
            <Mail
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--auth-muted)] transition-colors group-focus-within:text-emerald-300"
              aria-hidden="true"
            />
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setValidationError(null);
              }}
              placeholder="voce@empresa.com.br"
              disabled={forgotPassword.isPending}
              aria-invalid={validationError || requestError ? true : undefined}
              aria-describedby={
                validationError ? 'forgot-email-error' : requestError ? 'forgot-request-error' : undefined
              }
              className={authFieldClasses}
            />
          </div>
        </div>

        {validationError || requestError ? (
          <div
            id={validationError ? 'forgot-email-error' : 'forgot-request-error'}
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{validationError ?? requestError}</span>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={forgotPassword.isPending}
          aria-busy={forgotPassword.isPending}
          className={authSubmitClasses}
        >
          {forgotPassword.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Enviando...
            </>
          ) : (
            <>
              Enviar link de recuperação
              <ArrowRight className="size-4" aria-hidden="true" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-6 border-t border-white/[0.06] pt-5 text-center">
        <Link
          to="/login"
          className={cn('inline-flex items-center gap-1.5 text-xs font-medium', authLinkClasses)}
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Voltar para o login
        </Link>
      </div>
    </AuthShell>
  );
}
