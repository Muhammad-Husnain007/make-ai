import { Children, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { requestRegisterOtp, requestResetOtp, verifyRegisterOtp, verifyResetOtp } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { invitationPath, routes, signUpPath } from '../lib/routes.js';

function Field({ label, type = 'text', value, onChange, autoComplete, readOnly, inputMode, maxLength }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-zinc-400">{label}</span>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-white/10 bg-ink-800 px-3 text-sm outline-none focus:border-orange-400/50 read-only:text-zinc-400"
      />
    </label>
  );
}

function PasswordField({ label, value, onChange, autoComplete = 'new-password' }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-zinc-400">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-lg border border-white/10 bg-ink-800 px-3 pr-11 text-sm outline-none focus:border-orange-400/50"
        />
        <button
          type="button"
          onClick={() => setShow((value) => !value)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
          aria-label={show ? 'Hide password' : 'View password'}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </label>
  );
}

function AuthBrand() {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-ink-950 shadow-[0_0_24px_rgba(249,115,22,.35)] sm:h-12 sm:w-12">
        <ShieldAlert size={22} />
      </span>
      <div>
        <div className="text-lg font-bold tracking-tight sm:text-xl">Pulse</div>
        <div className="text-xs text-zinc-500">Error command center</div>
      </div>
    </div>
  );
}

function AuthLayout({ children }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-ink-950 text-zinc-100">
      <div className="absolute left-4 top-4 z-10 sm:left-8 sm:top-8">
        <AuthBrand />
      </div>
      <div className="absolute right-4 top-4 z-10 sm:right-8 sm:top-8">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}

function AuthCard({ title, subtitle, step, total, footer, children }) {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-white/5 bg-ink-900 p-5 sm:p-6">
        {total > 1 && (
          <div className="mb-5 flex gap-1.5">
            {Array.from({ length: total }, (_, index) => (
              <span key={index} className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-orange-400' : 'bg-white/10'}`} />
            ))}
          </div>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500">{subtitle}</p>
        {children}
      </div>
      {footer && <p className="mt-4 text-center text-sm text-zinc-500">{footer}</p>}
    </div>
  );
}

function AuthSlider({ step, children }) {
  return (
    <div
      className="flex min-h-screen transition-transform duration-500 ease-out"
      style={{ transform: `translateX(-${step * 100}vw)` }}
    >
      {Children.map(children, (child, index) => (
        <div
          className={`flex min-h-screen w-screen shrink-0 items-center justify-center px-4 pb-8 pt-24 sm:px-6 ${index === step ? '' : 'pointer-events-none'}`}
          aria-hidden={index !== step}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <AuthLayout>
      <div className="flex min-h-screen items-center justify-center px-4 pb-8 pt-24 sm:px-6">
        <AuthCard title={title} subtitle={subtitle} footer={footer}>
          {children}
        </AuthCard>
      </div>
    </AuthLayout>
  );
}

function StepActions({ step, last, busy, done, lastLabel, onBack }) {
  return (
    <>
      {done && <div className="mt-4 text-sm text-emerald-300">{done}</div>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
        {step > 0 && !done && (
          <button type="button" onClick={onBack} className="h-11 rounded-lg border border-white/10 px-4 text-sm text-zinc-300">
            Back
          </button>
        )}
        {!done && (
          <button disabled={busy} className="h-11 flex-1 rounded-lg bg-orange-500 text-sm font-medium text-ink-950 hover:bg-orange-400 disabled:opacity-50">
            {busy ? 'Please wait…' : step === last ? lastLabel : 'Next'}
          </button>
        )}
      </div>
    </>
  );
}

export function LoginPage() {
  const { user, ready, login, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite') || sessionStorage.getItem('pulse_invite') || '';
  const [mode, setMode] = useState('login');
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  const resetTitles = ['Your email', 'Verification code', 'New password'];
  const resetSubtitles = [
    'Enter the email for your Pulse account.',
    'Enter the 6-digit code sent to your email.',
    'Password must be at least 8 characters.',
  ];

  if (ready && user) {
    if (inviteToken && !user.company && !user.platformOwner) {
      return <Navigate to={invitationPath(inviteToken)} replace />;
    }
    return <Navigate to="/" replace />;
  }

  const goReset = (next) => {
    setError('');
    setDone('');
    setStep(next);
  };

  const openForgot = () => {
    setMode('reset');
    setStep(0);
    setOtp('');
    setPassword('');
    setError('');
    setDone('');
  };

  const closeForgot = () => {
    setMode('login');
    setStep(0);
    setOtp('');
    setPassword('');
    setError('');
    setDone('');
  };

  const onResetNext = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      if (step === 0) {
        await requestResetOtp({ email });
        goReset(1);
      } else if (step === 1) {
        await verifyResetOtp({ email, otp });
        goReset(2);
      } else {
        const data = await resetPassword({ email, otp, password });
        if (!data.token) {
          navigate(routes.signUpPending, { replace: true });
          return;
        }
        sessionStorage.removeItem('pulse_invite');
        navigate(inviteToken ? invitationPath(inviteToken) : routes.home, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resetFooter = <>Remembered it? <button type="button" onClick={closeForgot} className="text-orange-300 hover:underline">Back to login</button></>;
  const resetFields = [
    <Field key="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />,
    <Field key="otp" label="6-digit code" value={otp} onChange={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" maxLength={6} />,
    <PasswordField key="password" label="New password" value={password} onChange={setPassword} />,
  ];

  if (mode === 'reset') {
    return (
      <AuthLayout>
        <div className="auth-from-right">
          <AuthSlider step={step}>
        {resetTitles.map((title, index) => (
          <AuthCard
            key={title}
            title={title}
            subtitle={resetSubtitles[index]}
            step={index}
            total={resetTitles.length}
            footer={resetFooter}
          >
            <form onSubmit={index === step ? onResetNext : (event) => event.preventDefault()}>
              {resetFields[index]}
              {error && index === step && <div className="mt-4 text-sm text-red-300">{error}</div>}
              <StepActions
                step={index}
                last={2}
                busy={busy}
                done={index === 2 ? done : ''}
                lastLabel="Save password and login"
                onBack={() => goReset(index - 1)}
              />
            </form>
          </AuthCard>
        ))}
          </AuthSlider>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Login is only for people who already have Pulse access."
      footer={<>No account? <Link to={inviteToken ? signUpPath({ invite: inviteToken }) : routes.signUp} className="text-orange-300 hover:underline">Register</Link></>}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await login({ email, password, inviteToken: inviteToken || undefined });
            sessionStorage.removeItem('pulse_invite');
            navigate('/', { replace: true });
          } catch (err) {
            if (err.inviteToken) {
              sessionStorage.setItem('pulse_invite', err.inviteToken);
              navigate(invitationPath(err.inviteToken), { replace: true });
              return;
            }
            if (err.message?.includes('do not have access')) {
              navigate(routes.signUpPending, { replace: true });
              return;
            }
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="flex justify-end">
          <button type="button" onClick={openForgot} className="text-sm text-orange-300 hover:underline">
            Forgot password
          </button>
        </div>
        {error && <div className="text-sm text-red-300">{error}</div>}
        <button disabled={busy} className="h-11 w-full rounded-lg bg-orange-500 text-sm font-medium text-ink-950 hover:bg-orange-400 disabled:opacity-50">
          {busy ? 'Signing in…' : 'Login'}
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, ready, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite') || sessionStorage.getItem('pulse_invite') || '';
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') || '');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  const titles = ['Your name', 'Your email', 'Verification code', 'Create password'];
  const subtitles = [
    'Enter your name to get started.',
    inviteToken ? 'Use the invited email address.' : 'We will send a 6-digit code to this email.',
    'Enter the 6-digit code sent to your email.',
    'Password must be at least 8 characters.',
  ];

  if (ready && user) {
    if (inviteToken && !user.company && !user.platformOwner) {
      return <Navigate to={invitationPath(inviteToken)} replace />;
    }
    return <Navigate to="/" replace />;
  }

  const go = (next) => {
    setError('');
    setDone('');
    setStep(next);
  };

  const onNext = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      if (step === 0) {
        if (name.trim().length < 2) throw new Error('Name must be 2–80 characters.');
        go(1);
      } else if (step === 1) {
        await requestRegisterOtp({ name, email });
        go(2);
      } else if (step === 2) {
        await verifyRegisterOtp({ email, otp });
        go(3);
      } else {
        const data = await register({ name, email, password, otp, inviteToken: inviteToken || undefined });
        const pendingToken = data.inviteToken || inviteToken;
        if (!data.token || data.needsInvite) {
          if (pendingToken) {
            sessionStorage.setItem('pulse_invite', pendingToken);
            navigate(invitationPath(pendingToken), { replace: true });
            return;
          }
          navigate(routes.signUpPending, { replace: true });
          return;
        }
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const footer = inviteToken
    ? null
    : <>Already have an account? <Link to={routes.signIn} className="text-orange-300 hover:underline">Login</Link></>;
  const fields = [
    <Field key="name" label="Name" value={name} onChange={setName} autoComplete="name" />,
    <Field key="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" readOnly={Boolean(params.get('email'))} />,
    <Field key="otp" label="6-digit code" value={otp} onChange={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" maxLength={6} />,
    <PasswordField key="password" label="Password" value={password} onChange={setPassword} />,
  ];

  return (
    <AuthLayout>
    <AuthSlider step={step}>
      {titles.map((title, index) => (
        <AuthCard
          key={title}
          title={title}
          subtitle={subtitles[index]}
          step={index}
          total={titles.length}
          footer={footer}
        >
          <form onSubmit={index === step ? onNext : (event) => event.preventDefault()}>
            {fields[index]}
            {error && index === step && <div className="mt-4 text-sm text-red-300">{error}</div>}
            <StepActions
              step={index}
              last={3}
              busy={busy}
              done={index === 3 ? done : ''}
              lastLabel="Create account"
              onBack={() => go(index - 1)}
            />
          </form>
        </AuthCard>
      ))}
    </AuthSlider>
    </AuthLayout>
  );
}

export function RegisterThanksPage() {
  const { user, ready } = useAuth();
  if (ready && user) return <Navigate to="/" replace />;

  return (
    <AuthShell
      title="Thank you"
      subtitle="Your Pulse account is created."
    >
      <div className="flex flex-col items-center text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/15 text-orange-300">
          <CheckCircle2 size={26} />
        </span>
        <p className="text-sm leading-6 text-zinc-300">
          Thank you for registering. You do not have access to the dashboard yet.
          When someone invites this email to Pulse, open that invitation to continue.
        </p>
      </div>
    </AuthShell>
  );
}
