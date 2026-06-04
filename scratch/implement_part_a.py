import re

def main():
    path = "src/app/components/Login.tsx"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Add sendPasswordResetEmail to import
    old_import = "import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithCredential } from 'firebase/auth';"
    new_import = "import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithCredential, sendPasswordResetEmail } from 'firebase/auth';"
    if old_import in content:
        content = content.replace(old_import, new_import)

    # Add handleForgotPassword logic
    old_handle_social = "  const handleSocialLogin = async () => {"
    new_handle_forgot = """  const [resetMessage, setResetMessage] = useState<string | null>(null);

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

  const handleSocialLogin = async () => {"""
    
    if old_handle_social in content:
        content = content.replace(old_handle_social, new_handle_forgot)

    # Add button to UI and render reset message
    old_error_render = """            {error && (
              <div className="text-red-500 text-sm text-center bg-red-900/20 border border-red-500/30 rounded-md p-2">
                {error}
              </div>
            )}"""

    new_error_render = """            {error && (
              <div className="text-red-500 text-sm text-center bg-red-900/20 border border-red-500/30 rounded-md p-2">
                {error}
              </div>
            )}
            {resetMessage && (
              <div className="text-green-500 text-sm text-center bg-green-900/20 border border-green-500/30 rounded-md p-2">
                {resetMessage}
              </div>
            )}"""

    if old_error_render in content:
        content = content.replace(old_error_render, new_error_render)

    old_submit_btn = """            <Button
              type="submit"
              disabled={isSubmitting || isSocialLoading}"""
    
    new_submit_btn = """            {!isSignUp && (
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
              disabled={isSubmitting || isSocialLoading}"""

    if old_submit_btn in content:
        content = content.replace(old_submit_btn, new_submit_btn)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
