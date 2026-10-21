import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Minus,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { AuthShell } from './auth-shell';
import { authFieldClasses, authLabelClasses, authLinkClasses, authSubmitClasses } from './auth-styles';
import { useResetPassword } from './queries';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const resetPassword = useResetPassword();

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    meta.dataset.resetPassword = 'true';
    document.head.appendChild(meta);

    return () => {
      meta.remove();
    };
  }, []);

  const requestError =
    resetPassword.error instanceof ApiError
      ? resetPassword.error.message
      : resetPassword.error
        ? 'Não foi possível redefinir sua senha. Tente novamente.'
        : null;

  const errorMessage = formError ?? requestError;
  const hasMinimumLength = password.length >= MIN_PASSWORD_LENGTH;
  const hasMaximumLength = password.length <= MAX_PASSWORD_LENGTH;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  if (success) {
    return (
      <AuthShell
        badge={
          <>
            <CheckCircle2 className="size-3" aria-hidden="true" />
            Senha atualizada
          </>
        }
        title="Senha redefinida"
        description="Sua nova senha já está ativa. Entre novamente para continuar."
      >
        <div className="space-y-6">
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-4 py-3.5 text-sm leading-relaxed text-emerald-100"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Sua senha foi alterada com sucesso. Agora você já pode entrar com a nova senha.</span>
          </div>

          <Button asChild className={authSubmitClasses}>
            <Link to="/login">
              Ir para o login
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (!token) {
    return (
      <AuthShell
        badge={
          <>
            <XCircle className="size-3" aria-hidden="true" />
            Link indisponível
          </>
        }
        title="Link inválido"
        description="Este link de recuperação está incompleto ou expirou."
      >
        <div className="space-y-6">
          <p className="text-sm leading-relaxed text-[var(--auth-muted)]">
            Solicite um novo link para redefinir sua senha com segurança.
          </p>

          <Button asChild className={authSubmitClasses}>
            <Link to="/esqueci-senha">
              Solicitar novo link
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>

          <div className="border-t border-white/[0.06] pt-5 text-center">
            <Link
              to="/login"
              className={cn('inline-flex items-center gap-1.5 text-xs font-medium', authLinkClasses)}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Voltar para o login
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (!hasMinimumLength) {
      setFormError(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    if (!hasMaximumLength) {
      setFormError(`A senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    if (password !== confirmPassword) {
      setFormError('As senhas não conferem.');
      return;
    }

    setFormError(null);
    resetPassword.mutate(
      { token, newPassword: password },
      {
        onSuccess: () => {
          setSuccess(true);
          navigate('/redefinir-senha', { replace: true });
        },
      },
    );
  };

  return (
    <AuthShell
      badge={
        <>
          <KeyRound className="size-3" aria-hidden="true" />
          Nova senha
        </>
      }
      title="Redefinir senha"
      description="Crie uma nova senha para acessar sua conta no OrderUp CRM."
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password" className={authLabelClasses}>
            Nova senha
          </Label>
          <div className="group relative">
            <Lock
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--auth-muted)] transition-colors group-focus-within:text-emerald-300"
              aria-hidden="true"
            />
            <Input
              id="new-password"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFormError(null);
              }}
              placeholder="••••••••"
              disabled={resetPassword.isPending}
              aria-invalid={errorMessage ? true : undefined}
              aria-describedby="password-rules"
              className={cn(authFieldClasses, 'pr-11')}
            />
            <button
              type="button"
              onClick={() => setPasswordVisible((visible) => !visible)}
              aria-label={passwordVisible ? 'Ocultar senhas' : 'Mostrar senhas'}
              aria-pressed={passwordVisible}
              aria-controls="new-password confirm-password"
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-[var(--auth-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--auth-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            >
              {passwordVisible ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password" className={authLabelClasses}>
            Confirmar nova senha
          </Label>
          <div className="group relative">
            <Lock
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--auth-muted)] transition-colors group-focus-within:text-emerald-300"
              aria-hidden="true"
            />
            <Input
              id="confirm-password"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setFormError(null);
              }}
              placeholder="Repita a nova senha"
              disabled={resetPassword.isPending}
              aria-invalid={errorMessage ? true : undefined}
              aria-describedby={errorMessage ? 'reset-password-error' : undefined}
              className={authFieldClasses}
            />
          </div>
        </div>

        <ul id="password-rules" className="space-y-1.5 text-xs text-[var(--auth-muted)]">
          <PasswordRule met={hasMinimumLength} label={`Pelo menos ${MIN_PASSWORD_LENGTH} caracteres`} />
          <PasswordRule met={hasMaximumLength} label={`No máximo ${MAX_PASSWORD_LENGTH} caracteres`} />
          <PasswordRule met={passwordsMatch} label="As senhas conferem" />
        </ul>

        {errorMessage ? (
          <div
            id="reset-password-error"
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={resetPassword.isPending}
          aria-busy={resetPassword.isPending}
          className={authSubmitClasses}
        >
          {resetPassword.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Redefinindo...
            </>
          ) : (
            <>
              Redefinir senha
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

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <li className={cn('flex items-center gap-2', met ? 'text-emerald-300' : undefined)}>
      {met ? (
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Minus className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
      <span className="sr-only">{met ? 'atendido' : 'pendente'}</span>
    </li>
  );
}
