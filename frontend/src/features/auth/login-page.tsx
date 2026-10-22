import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from '@/features/auth/queries';
import { ApiError } from '@/lib/api-client';
import { storePasswordCredential } from '@/lib/password-credentials';
import { cn } from '@/lib/utils';
import { LoginShowcase } from './login-showcase';
import {
  authFieldClasses as fieldClasses,
  authLabelClasses,
  authLinkClasses,
  authSubmitClasses,
} from './auth-styles';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const login = useLogin((input) => {
    if (rememberPassword) {
      void storePasswordCredential(input.email, input.password);
    }
  });

  const errorMessage =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Não foi possível entrar. Verifique suas credenciais.'
        : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    login.mutate({ email: email.trim(), password });
  };

  return (
    <div className="auth-screen relative min-h-dvh overflow-hidden">
      <div className="auth-canvas pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1680px] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <LoginShowcase />

        <main className="relative flex min-h-dvh flex-col justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:py-12 xl:px-16">
          <div className="auth-panel-glow pointer-events-none absolute inset-0" aria-hidden="true" />

          <div className="relative mx-auto flex w-full max-w-[26rem] flex-col">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <img
                src="/images/logo-orderup.png"
                alt="OrderUp"
                className="size-11 rounded-xl shadow-[0_10px_30px_-14px_rgba(0,0,0,0.9)] ring-1 ring-white/10"
              />
              <div>
                <p className="text-base font-semibold tracking-tight">OrderUp CRM</p>
                <p className="text-xs text-[var(--auth-muted)]">Atendimento omnichannel</p>
              </div>
            </div>

            <div className="mb-5 hidden items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--auth-muted)] lg:flex">
              <ShieldCheck className="size-3.5 text-emerald-400/80" />
              Acesso seguro
            </div>

            <div className="auth-form-surface rounded-2xl p-6 sm:p-8">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-3 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-emerald-300">
                  <Sparkles className="size-3" />
                  Bem-vindo de volta
                </span>
                <h1 className="text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.85rem]">
                  Entre na sua conta
                </h1>
                <p className="text-sm leading-relaxed text-[var(--auth-muted)]">
                  Acesse o painel da sua organização e continue de onde parou.
                </p>
              </div>

              <form
                id="login-form"
                name="login"
                method="post"
                action="/api/auth/login"
                autoComplete="on"
                className="mt-7 space-y-5"
                onSubmit={handleSubmit}
              >
                <div className="space-y-2">
                  <Label
                    htmlFor="email"
                    className={authLabelClasses}
                  >
                    E-mail
                  </Label>
                  <div className="group relative">
                    <Mail
                      className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--auth-muted)] transition-colors group-focus-within:text-emerald-300"
                      aria-hidden="true"
                    />
                    <Input
                      id="email"
                      name="username"
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="voce@empresa.com.br"
                      disabled={login.isPending}
                      aria-invalid={errorMessage ? true : undefined}
                      aria-describedby={errorMessage ? 'login-error' : undefined}
                      className={fieldClasses}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="password"
                    className={authLabelClasses}
                  >
                    Senha
                  </Label>
                  <div className="group relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--auth-muted)] transition-colors group-focus-within:text-emerald-300"
                      aria-hidden="true"
                    />
                    <Input
                      id="password"
                      name="password"
                      type={passwordVisible ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      disabled={login.isPending}
                      aria-invalid={errorMessage ? true : undefined}
                      aria-describedby={errorMessage ? 'login-error' : undefined}
                      className={cn(fieldClasses, 'pr-11')}
                    />
                    <button
                      type="button"
                      onClick={() => setPasswordVisible((visible) => !visible)}
                      aria-label={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                      aria-pressed={passwordVisible}
                      aria-controls="password"
                      className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-[var(--auth-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--auth-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                    >
                      {passwordVisible ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <label
                      htmlFor="remember-password"
                      className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-[var(--auth-muted)] transition-colors hover:text-[var(--auth-foreground)]"
                    >
                      <input
                        id="remember-password"
                        name="remember-password"
                        type="checkbox"
                        checked={rememberPassword}
                        onChange={(event) => setRememberPassword(event.target.checked)}
                        disabled={login.isPending}
                        className="size-4 shrink-0 cursor-pointer rounded border border-white/20 bg-white/[0.04] accent-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      Lembrar senha
                    </label>
                    <Link
                      to="/esqueci-senha"
                      className={cn('text-xs font-medium', authLinkClasses)}
                    >
                      Esqueci minha senha
                    </Link>
                  </div>
                </div>

                {errorMessage ? (
                  <div
                    id="login-error"
                    role="alert"
                    className="flex items-start gap-2.5 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-200"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>{errorMessage}</span>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  disabled={login.isPending}
                  aria-busy={login.isPending}
                  className={authSubmitClasses}
                >
                  {login.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Entrando...
                    </>
                  ) : (
                    <>
                      Entrar
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-2 border-t border-white/[0.06] pt-5 text-[11px] text-[var(--auth-muted)]">
                <ShieldCheck className="size-3.5 text-emerald-400/80" aria-hidden="true" />
                Conexão segura · Acesso restrito à equipe
              </div>
            </div>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--auth-muted)]">
              © {new Date().getFullYear()} OrderUp CRM. Todos os direitos reservados.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
