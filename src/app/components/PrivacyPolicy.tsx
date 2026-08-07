import { useEffect } from 'react';

interface PrivacyPolicyProps {
  onClose: () => void;
}

export function PrivacyPolicy({ onClose }: PrivacyPolicyProps) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, #18181b 0%, #111113 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
          style={{ background: 'linear-gradient(180deg,#18181b 70%,transparent)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <h1 className="text-lg font-bold text-white">Política de Privacidad</h1>
              <p className="text-xs text-zinc-500">Última actualización: agosto 2026</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>

        {/* Contenido */}
        <div className="px-6 pb-8 pt-4 space-y-6 text-sm text-zinc-300 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-white mb-2">¿Quiénes somos?</h2>
            <p>Vibe es una plataforma de música en streaming operada de forma independiente. Nos importa tu privacidad y queremos ser completamente transparentes sobre qué datos recopilamos y por qué.</p>
          </section>
          <div className="h-px bg-white/5" />
          <section>
            <h2 className="text-base font-semibold text-white mb-2">¿Qué datos recopilamos?</h2>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span><strong className="text-white">Cuenta de Google:</strong> Al iniciar sesión con Google, obtenemos tu nombre, correo electrónico y foto de perfil a través de Firebase Authentication. No almacenamos tu contraseña.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span><strong className="text-white">Historial de escucha:</strong> Guardamos las canciones que reproduces para ofrecerte recomendaciones personalizadas.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span><strong className="text-white">Playlists y favoritos:</strong> Las listas de reproducción que creas y las canciones que marcas como favoritas.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span><strong className="text-white">Datos de uso básicos:</strong> Información anónima de rendimiento para mejorar la experiencia de la app.</span></li>
            </ul>
          </section>
          <div className="h-px bg-white/5" />
          <section>
            <h2 className="text-base font-semibold text-white mb-2">¿Para qué usamos tus datos?</h2>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-green-400 mt-0.5">✓</span><span>Identificarte y permitirte iniciar sesión de forma segura.</span></li>
              <li className="flex gap-2"><span className="text-green-400 mt-0.5">✓</span><span>Ofrecerte recomendaciones de música personalizadas.</span></li>
              <li className="flex gap-2"><span className="text-green-400 mt-0.5">✓</span><span>Sincronizar tu historial y playlists entre dispositivos.</span></li>
              <li className="flex gap-2"><span className="text-red-400 mt-0.5">✕</span><span>Nunca vendemos tus datos a terceros.</span></li>
              <li className="flex gap-2"><span className="text-red-400 mt-0.5">✕</span><span>Nunca usamos tus datos con fines publicitarios.</span></li>
            </ul>
          </section>
          <div className="h-px bg-white/5" />
          <section>
            <h2 className="text-base font-semibold text-white mb-2">Cookies y almacenamiento local</h2>
            <p>Vibe usa el <strong className="text-white">almacenamiento local</strong> de tu navegador (localStorage) para guardar tus preferencias de sesión y mejorar la velocidad de carga. No usamos cookies de seguimiento ni publicidad.</p>
          </section>
          <div className="h-px bg-white/5" />
          <section>
            <h2 className="text-base font-semibold text-white mb-2">Tus derechos</h2>
            <p className="mb-2">De acuerdo con las leyes de protección de datos, tienes derecho a:</p>
            <ul className="space-y-1.5">
              <li className="flex gap-2"><span className="text-purple-400">→</span><span><strong className="text-white">Acceder</strong> a los datos que tenemos sobre ti.</span></li>
              <li className="flex gap-2"><span className="text-purple-400">→</span><span><strong className="text-white">Rectificar</strong> cualquier dato incorrecto.</span></li>
              <li className="flex gap-2"><span className="text-purple-400">→</span><span><strong className="text-white">Eliminar</strong> tu cuenta y todos tus datos (desde Perfil → Restablecer mis datos).</span></li>
              <li className="flex gap-2"><span className="text-purple-400">→</span><span><strong className="text-white">Oponerte</strong> al procesamiento de tus datos en cualquier momento.</span></li>
            </ul>
          </section>
          <div className="h-px bg-white/5" />
          <section>
            <h2 className="text-base font-semibold text-white mb-2">Menores de edad</h2>
            <p>Vibe no está dirigido a menores de 13 años. Si eres padre o tutor y crees que tu hijo ha creado una cuenta, contáctanos para eliminarla.</p>
          </section>
          <div className="h-px bg-white/5" />
          <section>
            <h2 className="text-base font-semibold text-white mb-2">Cambios en esta política</h2>
            <p>Podemos actualizar esta Política de Privacidad ocasionalmente. Cuando lo hagamos, actualizaremos la fecha en la parte superior.</p>
          </section>
          <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}>
            <p className="text-zinc-400 text-xs">¿Tienes preguntas sobre tu privacidad?<br />Escríbenos a <span className="text-purple-400">privacidad@vibe.app</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
