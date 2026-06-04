import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
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
  const [isSignUp, setIsSignUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // onLogin() no es necesario aquí, el observador en App.tsx se encargará del resto.
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

  const [resetMessage, setResetMessage] = useState<string | null>(null);

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
      }
      else {
        setError("No se pudo iniciar sesión con Google. Inténtalo de nuevo.");
      }
    } finally {
      setIsSocialLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-gradient-to-br from-violet-950 via-black to-fuchsia-950/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo y Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <img src="/ico.png" alt="Vibe Logo" className="w-12 h-12" />
            <h1 className="text-4xl font-bold text-white">Vibe</h1>
          </div>
          <p className="text-zinc-400 text-lg">
            {isSignUp ? 'Crea tu cuenta y empieza a escuchar' : 'Inicia sesión en tu cuenta'}
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-black border border-zinc-800 rounded-lg p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                required
                disabled={isSubmitting || isSocialLoading}
                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-2">
                Contraseña
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                required
                disabled={isSubmitting || isSocialLoading}
                className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            </div>

            {isSignUp && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-300 mb-2">
                  Confirmar contraseña
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  required
                  disabled={isSubmitting || isSocialLoading}
                  className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
            )}

            {error && (
              <div className="text-red-500 text-sm text-center bg-red-900/20 border border-red-500/30 rounded-md p-2">
                {error}
              </div>
            )}
            {resetMessage && (
              <div className="text-green-500 text-sm text-center bg-green-900/20 border border-green-500/30 rounded-md p-2">
                {resetMessage}
              </div>
            )}

            {!isSignUp && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isSubmitting || isSocialLoading}
                  className="text-xs text-violet-400 hover:text-white transition-colors disabled:opacity-50 mt-1"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            )}
            
            <Button
              type="submit"
              disabled={isSubmitting || isSocialLoading}
              className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white font-semibold py-6 rounded-full transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Cargando...
                </span>
              ) : (
                isSignUp ? 'Crear cuenta' : 'Iniciar sesión'
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-black text-zinc-500">o continúa con</span>
            </div>
          </div>

          {/* Social Login */}
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting || isSocialLoading}
              className="w-full bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800 py-6 rounded-full disabled:opacity-50"
              onClick={handleSocialLogin}
            >
              {isSocialLoading ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              Google
            </Button>
          </div>

          {/* Toggle Sign Up */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              disabled={isSubmitting || isSocialLoading}
              className="text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
            >
              {isSignUp ? (
                <>
                  ¿Ya tienes cuenta?{' '}
                  <span className="text-violet-400 font-medium">Inicia sesión</span>
                </>
              ) : (
                <>
                  ¿No tienes cuenta?{' '}
                  <span className="text-violet-400 font-medium">Regístrate</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-zinc-500 text-xs mt-8">
          Al continuar, aceptas los Términos de Servicio y la Política de Privacidad de Vibe
        </p>
      </div>
    </div>
  );
}
