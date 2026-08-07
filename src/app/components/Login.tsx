import { useState } from 'react';
import { PrivacyPolicy } from './PrivacyPolicy';
import { TermsOfService } from './TermsOfService';
import { Eye, EyeOff } from 'lucide-react';
import { auth } from '../../firebaseConfig';
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithCredential, sendPasswordResetEmail } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { isNativePlatform } from '../utils/platform';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (isSignUp && password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      setIsSubmitting(false);
      return;
    }

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      console.error("Error de autenticación:", error);
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        setError("El correo o la contraseña son incorrectos.");
      } else if (error.code === 'auth/email-already-in-use') {
        setError("Este correo ya está registrado.");
      } else {
        setError("Ha ocurrido un error. Inténtalo de nuevo.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Por favor ingresa tu correo electrónico para restablecer la contraseña.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setResetMessage(null);
    try {
      console.log('[auth/reset-password] start');
      await sendPasswordResetEmail(auth, email);
      console.log('[auth/reset-password] sent');
      setResetMessage("Te enviamos un correo para restablecer tu contraseña.");
    } catch (error: any) {
      console.error("[auth/reset-password] failed code=", error?.code, error);
      if (error.code === 'auth/invalid-email') {
        setError("Correo inválido.");
      } else if (error.code === 'auth/user-not-found') {
        setError("No existe una cuenta con ese correo.");
      } else if (error.code === 'auth/too-many-requests') {
        setError("Demasiados intentos, prueba más tarde.");
      } else {
        setError("No pudimos enviar el correo.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialLogin = async () => {
    setIsSocialLoading(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      if (isNativePlatform()) {
        const res: any = await FirebaseAuthentication.signInWithGoogle();
        const idToken = res?.credential?.idToken;
        const accessToken = res?.credential?.accessToken;
        if (!idToken && !accessToken) throw new Error('missing_credential');
        const cred = GoogleAuthProvider.credential(idToken || undefined, accessToken || undefined);
        await signInWithCredential(auth, cred);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (error: any) {
      console.error("Error durante el inicio de sesión con Google:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setError("El proceso de inicio de sesión fue cancelado.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // No mostrar error si simplemente se canceló
      } else {
        setError("No se pudo iniciar sesión con Google. Inténtalo de nuevo.");
      }
    } finally {
      setIsSocialLoading(false);
    }
  };

  const switchTab = (signUp: boolean) => {
    setIsSignUp(signUp);
    setError(null);
    setResetMessage(null);
  };

  const isDisabled = isSubmitting || isSocialLoading;

  return (
    <div className="login-page">
      {/* ── Panel Izquierdo: Branding ── */}
      <aside className="login-left-panel">
        {/* Elementos decorativos de fondo para llenar el panel morado */}
        <div className="login-purple-blob login-purple-blob--1" />
        <div className="login-purple-blob login-purple-blob--2" />

        <div className="login-brand">
          <img src="/ico.png" alt="Vibe" className="login-brand-icon" />
          <span className="login-brand-name">VIBE</span>
        </div>

        {/* Abstract Vinyl / Soundwave Graphic to fill empty space */}
        <div className="login-vinyl-graphic">
          <div className="vinyl-ring vinyl-ring-1" />
          <div className="vinyl-ring vinyl-ring-2" />
          <div className="vinyl-ring vinyl-ring-3" />
          <div className="vinyl-center">
            <div className="vinyl-dot" />
          </div>
          {/* Floating musical notes around the vinyl */}
          <span className="vinyl-note vinyl-note-1">♪</span>
          <span className="vinyl-note vinyl-note-2">♫</span>
          <span className="vinyl-note vinyl-note-3">♬</span>
        </div>

        <div className="login-hero-text">
          <h1 className="login-hero-line1">SIENTE</h1>
          <h1 className="login-hero-line2">CADA</h1>
          <h1 className="login-hero-line3">NOTA</h1>
          <p className="login-hero-sub">Tu música, tu momento</p>
        </div>

        {/* Equalizer animado */}
        <div className="login-equalizer-area">
          <div className="login-equalizer">
            {[...Array(14)].map((_, i) => (
              <div
                key={i}
                className="login-eq-bar"
                style={{
                  animationDelay: `${i * 0.13}s`,
                  animationDuration: `${1 + Math.random() * 0.6}s`,
                }}
              />
            ))}
          </div>
          <span className="login-copyright">© 2026 VIBE</span>
        </div>
      </aside>

      {/* ── Panel Derecho: Formulario ── */}
      <main className="login-main">
        <div className="login-form-container">
          {/* Tabs con underline deslizante */}
          <div className="login-tabs">
            <button
              type="button"
              className={`login-tab ${!isSignUp ? 'login-tab--active' : ''}`}
              onClick={() => switchTab(false)}
              disabled={isDisabled}
            >
              INICIAR SESIÓN
            </button>
            <button
              type="button"
              className={`login-tab ${isSignUp ? 'login-tab--active' : ''}`}
              onClick={() => switchTab(true)}
              disabled={isDisabled}
            >
              CREAR CUENTA
            </button>
            {/* Underline slider */}
            <div
              className="login-tab-slider"
              style={{ transform: isSignUp ? 'translateX(100%)' : 'translateX(0)' }}
            />
          </div>

          {/* Header */}
          <div className="login-form-header">
            <h2 className="login-form-title">
              {isSignUp ? 'Únete a Vibe' : 'Bienvenido'}
            </h2>
            <p className="login-form-subtitle">
              {isSignUp ? 'Crea tu cuenta gratis' : 'Ingresa tus datos para continuar'}
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="login-email" className="login-label">EMAIL</label>
              <input
                id="login-email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                required
                disabled={isDisabled}
                className="login-input"
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password" className="login-label">CONTRASEÑA</label>
              <div className="login-input-wrapper">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  required
                  disabled={isDisabled}
                  className="login-input login-input--has-icon"
                />
                <button
                  type="button"
                  className="login-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {isSignUp && (
              <div className="login-field login-field--animate-in">
                <label htmlFor="login-confirm-password" className="login-label">CONFIRMAR CONTRASEÑA</label>
                <div className="login-input-wrapper">
                  <input
                    id="login-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                    required
                    disabled={isDisabled}
                    className="login-input login-input--has-icon"
                  />
                  <button
                    type="button"
                    className="login-eye-btn"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {!isSignUp && (
              <div className="login-forgot-row">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isDisabled}
                  className="login-forgot-link"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            )}

            {error && (
              <div className="login-error">{error}</div>
            )}
            {resetMessage && (
              <div className="login-success">{resetMessage}</div>
            )}

            <button
              type="submit"
              disabled={isDisabled}
              className="login-submit-btn"
            >
              {isSubmitting ? (
                <span className="login-btn-loading">
                  <div className="login-custom-loader">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  Autenticando...
                </span>
              ) : (
                isSignUp ? 'CREAR CUENTA' : 'ENTRAR'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="login-divider">
            <div className="login-divider-line" />
            <span className="login-divider-text">O CONTINÚA CON</span>
            <div className="login-divider-line" />
          </div>

          {/* Google — outline secondary */}
          <button
            type="button"
            disabled={isDisabled}
            className="login-google-btn"
            onClick={handleSocialLogin}
          >
            {isSocialLoading ? (
              <div className="login-custom-loader" style={{ filter: 'invert(1) hue-rotate(180deg)' }}>
                <span />
                <span />
                <span />
                <span />
              </div>
            ) : (
              <svg className="login-google-icon" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            GOOGLE
          </button>

          {/* Footer legal */}
          <p className="login-legal">
            Al continuar, aceptas los{' '}
            <button onClick={() => setShowTerms(true)} className="login-legal-link" style={{background:'none',border:'none',padding:0,cursor:'pointer'}}>Términos de Servicio</button>
            {' '}y{' '}
            <button onClick={() => setShowPrivacy(true)} className="login-legal-link" style={{background:'none',border:'none',padding:0,cursor:'pointer'}}>Política de Privacidad</button>
            {' '}de Vibe
          </p>
          {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
          {showTerms && <TermsOfService onClose={() => setShowTerms(false)} />}
        </div>

        {/* Notas musicales dispersas — esquina inferior derecha */}
        <div className="login-bg-notes" aria-hidden="true">
          <span className="login-bg-note login-bg-note--1">♪</span>
          <span className="login-bg-note login-bg-note--2">♫</span>
          <span className="login-bg-note login-bg-note--3">♩</span>
          <span className="login-bg-note login-bg-note--4">♬</span>
        </div>
      </main>
    </div>
  );
}
