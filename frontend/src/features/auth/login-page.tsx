import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Lock, Mail, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from '@/features/auth/queries';
import { ApiError } from '@/lib/api-client';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();

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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#070A12] p-10 text-white lg:flex">
        <div className="brand-gradient pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-25 blur-3xl" />
        <div className="brand-gradient pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full opacity-20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <img src="/images/logo-orderup.png" alt="OrderUp" className="size-10 rounded-lg" />
          <div>
            <p className="text-sm font-semibold">OrderUp</p>
            <p className="text-xs text-white/60">CRM</p>
          </div>
        </div>

        <div className="relative space-y-4">
          <h2 className="max-w-md text-3xl font-semibold leading-tight">
            Múltiplos WhatsApps, um chat centralizado e seus contatos.
          </h2>
          <p className="max-w-md text-sm text-white/70">
            Conecte vários números, acompanhe todas as conversas em um só lugar e mantenha o
            histórico organizado por contato.
          </p>
          <ul className="space-y-2 text-sm text-white/80">
            <li className="flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-400" /> Vários WhatsApps em um só lugar
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-400" /> Isolamento total entre organizações
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-400" /> Histórico de conversas por contato
            </li>
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} OrderUp. Todos os direitos reservados.
        </p>
      </div>

      <div className="flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center gap-3 lg:hidden">
              <img src="/images/logo-orderup.png" alt="OrderUp" className="size-9 rounded-lg" />
              <div>
                <p className="text-sm font-semibold">OrderUp CRM</p>
                <p className="text-xs text-muted-foreground">Acesso da equipe</p>
              </div>
            </div>

            <div className="space-y-1">
              <h1 className="text-lg font-semibold">Entrar na sua conta</h1>
              <p className="text-sm text-muted-foreground">
                Use as credenciais da sua organização.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="voce@empresa.com.br"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="pl-8"
                  />
                </div>
              </div>

              {errorMessage ? (
                <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 p-2.5 text-xs text-danger">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{errorMessage}</span>
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? <Loader2 className="animate-spin" /> : null}
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
