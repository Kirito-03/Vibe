interface TermsOfServiceProps {
  onClose: () => void;
}

export function TermsOfService({ onClose }: TermsOfServiceProps) {
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
            <span className="text-2xl">📋</span>
            <div>
              <h1 className="text-lg font-bold text-white">Términos y Condiciones</h1>
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
            <h2 className="text-base font-semibold text-white mb-2">1. Aceptación de los Términos</h2>
            <p>Al acceder y usar Vibe, aceptas quedar vinculado por estos Términos y Condiciones. Si no estás de acuerdo con alguna parte de los términos, no puedes acceder al servicio.</p>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">2. Descripción del Servicio</h2>
            <p>Vibe es una plataforma gratuita de descubrimiento y streaming de música que te permite buscar canciones, crear playlists y recibir recomendaciones personalizadas. El servicio se ofrece "tal cual", sin garantías de disponibilidad ininterrumpida.</p>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">3. Cuentas de Usuario</h2>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span>Debes tener al menos 13 años para usar Vibe.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span>Eres responsable de mantener la seguridad de tu cuenta.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span>No puedes crear cuentas de forma automatizada o con datos falsos.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">•</span><span>Nos reservamos el derecho de suspender cuentas que violen estos términos.</span></li>
            </ul>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">4. Uso Aceptable</h2>
            <p className="mb-2">Al usar Vibe, te comprometes a NO:</p>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-red-400 mt-0.5">✕</span><span>Usar el servicio para distribuir contenido ilegal, ofensivo o que infrinja derechos de autor.</span></li>
              <li className="flex gap-2"><span className="text-red-400 mt-0.5">✕</span><span>Intentar acceder a partes no autorizadas del sistema o de otros usuarios.</span></li>
              <li className="flex gap-2"><span className="text-red-400 mt-0.5">✕</span><span>Usar bots, scrapers o cualquier método automatizado para acceder al contenido.</span></li>
              <li className="flex gap-2"><span className="text-red-400 mt-0.5">✕</span><span>Sobrecargar intencionalmente la infraestructura del servicio.</span></li>
            </ul>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">5. Propiedad Intelectual y Música</h2>
            <p>Vibe actúa como un motor de búsqueda y reproducción que indexa contenido disponible públicamente. No alojamos, almacenamos permanentemente ni distribuimos archivos de audio con fines comerciales. Los derechos de cada canción pertenecen a sus respectivos artistas y sellos discográficos.</p>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">6. Servicio Gratuito y Cambios</h2>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-green-400 mt-0.5">✓</span><span>Vibe es completamente gratuito. No cobramos suscripciones ni comisiones.</span></li>
              <li className="flex gap-2"><span className="text-green-400 mt-0.5">✓</span><span>No existen cargos ocultos ni compras dentro de la app.</span></li>
              <li className="flex gap-2"><span className="text-purple-400 mt-0.5">→</span><span>Nos reservamos el derecho de modificar o descontinuar el servicio en cualquier momento, con o sin previo aviso.</span></li>
            </ul>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">7. Limitación de Responsabilidad</h2>
            <p>Vibe no se hace responsable por interrupciones del servicio, pérdida de datos o daños indirectos derivados del uso de la plataforma. El servicio se proporciona sin garantía de ningún tipo, expresa o implícita.</p>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">8. Modificaciones a los Términos</h2>
            <p>Podemos actualizar estos Términos en cualquier momento. El uso continuado de Vibe tras la publicación de cambios constituye tu aceptación de los nuevos términos.</p>
          </section>

          <div className="h-px bg-white/5" />

          <section>
            <h2 className="text-base font-semibold text-white mb-2">9. Cancelación de Cuenta</h2>
            <p>Puedes eliminar tu cuenta y todos tus datos en cualquier momento desde la sección de Perfil, usando la opción "Restablecer mis datos". También puedes contactarnos directamente para solicitar la eliminación completa.</p>
          </section>

          <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}>
            <p className="text-zinc-400 text-xs">¿Tienes preguntas sobre estos términos?<br />Escríbenos a <span className="text-purple-400">legal@vibe.app</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
