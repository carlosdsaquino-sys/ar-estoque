import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Snowflake, Lock, Mail, Loader2, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export default function AuthPage() {
  const { signIn } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setLoading(true);

    try {
      const result = await signIn(email.trim(), password);

      if (result.error) {
        setError(
          result.error === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : result.error
        );
      }
    } catch {
      setError('Não foi possível entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <SnowfallCursor />
      <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} className="absolute right-4 top-4 z-10 rounded-lg border border-white/20 p-2 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
        {theme === 'dark' ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
      </button>
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500 mb-4 shadow-lg shadow-sky-500/30">
            <Snowflake className="w-9 h-9 text-white" />
          </div>

          <h1 className="text-2xl font-bold text-white">
            Controle de Estoque
          </h1>

          <p className="text-slate-400 mt-1">
            Ar Condicionado - Instalação e Manutenção
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold text-slate-900">
              Acessar o sistema
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Informe seu e-mail e sua senha.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                E-mail
              </label>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />

                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-60"
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Senha
              </label>

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />

                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-60"
                  placeholder="Digite sua senha"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-500 hover:bg-sky-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-xs text-slate-500 mt-5 text-center">
            Acesso exclusivo para usuários autorizados.
            Para solicitar acesso, fale com o administrador.
          </p>
        </div>
      </div>
    </div>
  );
}

type SnowParticle = {
  id: number;
  x: number;
  y: number;
  size: number;
  rotation: number;
  opacity: number;
  duration: number;
  driftX: number;
  driftY: number;
  glyph: string;
  color: string;
};

const MAX_SNOW_PARTICLES = 25;
const SNOW_INTERVAL_MS = 60;
const snowGlyphs = ['❄', '❅', '❆'];
const snowColors = ['#ffffff', '#dbeafe', '#bfdbfe', '#e0f2fe'];

function SnowfallCursor() {
  const [particles, setParticles] = useState<SnowParticle[]>([]);
  const lastSpawn = useRef(0);
  const nextId = useRef(0);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const supportsMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const now = performance.now();
      if (!supportsMouse || reduceMotion || now - lastSpawn.current < SNOW_INTERVAL_MS) return;
      lastSpawn.current = now;

      const rootBounds = event.currentTarget instanceof Window
        ? document.documentElement.getBoundingClientRect()
        : null;
      const particle: SnowParticle = {
        id: ++nextId.current,
        x: event.clientX - (rootBounds?.left ?? 0),
        y: event.clientY - (rootBounds?.top ?? 0),
        size: 10 + Math.random() * 7,
        rotation: -30 + Math.random() * 60,
        opacity: 0.52 + Math.random() * 0.34,
        duration: 800 + Math.random() * 1000,
        driftX: -15 + Math.random() * 30,
        driftY: -10 - Math.random() * 20,
        glyph: snowGlyphs[Math.floor(Math.random() * snowGlyphs.length)],
        color: snowColors[Math.floor(Math.random() * snowColors.length)],
      };

      setParticles(current => [...current.slice(-(MAX_SNOW_PARTICLES - 1)), particle]);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  function removeParticle(id: number) {
    setParticles(current => current.filter(particle => particle.id !== id));
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {particles.map(particle => {
        const style = {
          left: particle.x,
          top: particle.y,
          fontSize: particle.size,
          color: particle.color,
          animationDuration: `${particle.duration}ms`,
          '--snow-opacity': particle.opacity,
          '--snow-x': `${particle.driftX}px`,
          '--snow-y': `${particle.driftY}px`,
          '--snow-rotation': `${particle.rotation}deg`,
        } as CSSProperties;
        return (
          <span
            key={particle.id}
            className="snow-cursor-particle absolute leading-none"
            style={style}
            onAnimationEnd={() => removeParticle(particle.id)}
          >
            {particle.glyph}
          </span>
        );
      })}
    </div>
  );
}
