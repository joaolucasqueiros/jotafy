'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined,
  Check,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
export default function Login() {
  const [register, setRegister] = useState(false),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setError(new URLSearchParams(location.search).get('error') || '');
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch(`/api/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      location.href = '/';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <span>
            meta<span className="brand-light">track</span>
            <span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="auth-story-content">
          <span className="subtle-badge">META ADS + CAKTO</span>
          <h1 style={{ marginTop: 25 }}>
            Invista com clareza.
            <br />
            Cresça com <span>dados reais.</span>
          </h1>
          <p>
            Conecte seus anúncios às vendas que realmente aconteceram. Uma única visão para decisões
            mais precisas.
          </p>
          <div className="auth-feature">
            <Check size={18} />
            Atribuição por campanha, conjunto e anúncio
          </div>
          <div className="auth-feature">
            <ChartNoAxesCombined size={18} />
            ROAS calculado com vendas confirmadas
          </div>
          <div className="auth-feature">
            <LockKeyhole size={18} />
            Rastreamento no servidor com consentimento
          </div>
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={14} />
          Seus dados, sua verdade. MetaTrack v1.0
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-form">
          <Link href="/" className="auth-back">
            <ArrowLeft size={14} />
            Explorar demonstração
          </Link>
          <h2>{register ? 'Sua operação começa aqui.' : 'Bom ter você de volta.'}</h2>
          <p>
            {register
              ? 'Crie sua conta para conectar a Meta e a Cakto.'
              : 'Entre para acompanhar cada conversão.'}
          </p>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <a className="button button-outline" href="/api/auth/meta">
            <span style={{ fontSize: 19, color: '#80aff2', lineHeight: 1 }}>f</span>Continuar com
            Facebook
          </a>
          <div className="auth-divider">ou use seu e-mail</div>
          <form onSubmit={submit}>
            {register && (
              <label className="form-label">
                Seu nome
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Como podemos chamar você?"
                />
              </label>
            )}
            <label className="form-label">
              E-mail
              <input
                required
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="voce@empresa.com.br"
              />
            </label>
            <label className="form-label">
              Senha
              <input
                required
                type="password"
                minLength={register ? 12 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={register ? 'Pelo menos 12 caracteres' : 'Digite sua senha'}
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 size={17} className="spin" /> : null}
              {register ? 'Criar minha conta' : 'Entrar no workspace'}
              <ArrowRight size={15} />
            </Button>
          </form>
          <div className="auth-toggle">
            {register ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
                setPassword('');
              }}
            >
              {register ? 'Entrar' : 'Criar conta'}
            </button>
          </div>
          <div className="auth-note">
            A conexão Facebook exige um aplicativo Meta configurado.
            <br />
            Ao conectar sua operação, verifique as obrigações de privacidade e consentimento
            aplicáveis ao seu negócio.
          </div>
        </div>
      </section>
    </div>
  );
}
