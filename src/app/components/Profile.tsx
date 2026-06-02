import { useEffect, useMemo, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Settings, LogOut, RotateCcw, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { EditProfile } from './EditProfile';
import { useAppSettings } from '../context/AppSettingsContext';
import { apiClearRecommendationCache, apiClearSeenTracks, apiFetch } from '../api';
import { usePlayback } from '../context/PlaybackContext';
import { useHomeData } from '../context/HomeDataContext';

interface ProfileProps {
  user: FirebaseUser | null;
  onLogout: () => void;
  onProfileUpdate: (user: FirebaseUser) => void;
}

export function Profile({ user, onLogout, onProfileUpdate }: ProfileProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetPreview, setResetPreview] = useState<any | null>(null);
  const [recoAction, setRecoAction] = useState<'clear_seen' | 'clear_cache' | null>(null);
  const [recoConfirm, setRecoConfirm] = useState('');
  const [recoSubmitting, setRecoSubmitting] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  const [recoSuccess, setRecoSuccess] = useState<string | null>(null);
  const { settings, updateSettings, isReady } = useAppSettings();
  const playback = usePlayback();
  const homeData = useHomeData();

  const confirmText = 'RESET_MY_VIBE_DATA';
  const canReset = useMemo(() => resetConfirm.trim() === confirmText, [resetConfirm]);
  const recoConfirmText = recoAction === 'clear_seen' ? 'CLEAR_SEEN_TRACKS' : 'CLEAR_RECOMMENDATION_CACHE';
  const canSubmitReco = useMemo(() => recoConfirm.trim() === recoConfirmText, [recoConfirm, recoConfirmText]);

  useEffect(() => {
    if (!showReset) return;
    setResetLoading(true);
    setResetError(null);
    setResetPreview(null);
    apiFetch('/api/user/reset-data/preview', { method: 'POST' })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(String(json?.error || 'preview'));
        setResetPreview(json);
      })
      .catch(() => setResetError('No se pudo preparar la vista previa. Intenta de nuevo.'))
      .finally(() => setResetLoading(false));
  }, [showReset]);

  const clearVnsLocalStorage = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('vns_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {}
  };

  const handleResetData = async () => {
    if (!canReset) return;
    setResetSubmitting(true);
    setResetError(null);
    try {
      const r = await apiFetch('/api/user/reset-data', {
        method: 'DELETE',
        body: JSON.stringify({ confirm: confirmText }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(String(json?.error || 'reset'));
      }
      playback.reset();
      clearVnsLocalStorage();
      homeData.clearHomeDataCache();
      setShowReset(false);
      setResetConfirm('');
      setTimeout(() => window.location.reload(), 80);
    } catch {
      setResetError('No se pudo restablecer tus datos. Intenta de nuevo.');
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleRecoAction = async () => {
    if (!recoAction || !canSubmitReco) return;
    setRecoSubmitting(true);
    setRecoError(null);
    setRecoSuccess(null);
    try {
      const res = recoAction === 'clear_seen' ? await apiClearSeenTracks() : await apiClearRecommendationCache();
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(json?.error || 'reco'));
      const deleted = typeof json?.deleted === 'number' ? json.deleted : null;
      setRecoSuccess(
        recoAction === 'clear_seen'
          ? `Listo. Se limpiaron ${deleted ?? 'varios'} registros de canciones vistas.`
          : `Listo. Se limpiaron ${deleted ?? 'varios'} registros de caché de recomendaciones.`
      );
      homeData.clearHomeDataCache();
      setRecoAction(null);
      setRecoConfirm('');
    } catch {
      setRecoError('No se pudo completar la acción. Intenta de nuevo.');
    } finally {
      setRecoSubmitting(false);
    }
  };

  if (!user || !isReady) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-zinc-900/50 to-black">
        <p className="text-zinc-400">Cargando perfil...</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-zinc-900/50 to-black">
      <div className="p-4 md:p-8 max-w-4xl mx-auto pb-32 md:pb-8">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">Perfil</h2>
          <p className="text-zinc-500 text-sm">Administra tu cuenta y preferencias</p>
        </div>

        {/* Profile Info */}
        <section className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 md:p-6 mb-4">
          <div className="flex items-center gap-4 md:gap-6">
            <div className="w-20 h-20 md:w-28 md:h-28 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0 ring-2 ring-violet-500/30">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Foto de perfil"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500">
                  <span className="text-4xl font-bold text-white">{user?.displayName?.charAt(0) || user?.email?.charAt(0)}</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl md:text-2xl font-bold text-white mb-1 truncate">{user?.displayName || 'Usuario'}</h3>
              <p className="text-zinc-400 text-sm mb-3">{user?.email}</p>
              <Button
                onClick={() => setIsEditing(true)}
                variant="outline"
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 text-sm"
              >
                Editar perfil
              </Button>
            </div>
          </div>
        </section>

        {isEditing && (
          <EditProfile 
            user={user} 
            onClose={() => setIsEditing(false)} 
            onProfileUpdate={onProfileUpdate}
          />
        )}

        {/* Preferences */}
        <section className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 md:p-6 mb-4">
          <div className="flex items-center gap-3 mb-5">
            <Settings className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg md:text-xl font-bold text-white">Preferencias</h3>
          </div>
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium text-sm md:text-base">Reproducción automática</p>
                <p className="text-xs md:text-sm text-zinc-500">Continúa reproduciendo música similar</p>
              </div>
              <Switch checked={settings.autoplay} onCheckedChange={(v) => updateSettings({ autoplay: v, audioQuality: settings.audioQuality })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white font-medium text-sm md:text-base">Calidad de audio</p>
                <p className="text-xs md:text-sm text-zinc-500">Afecta las descargas y el stream directo</p>
              </div>
              <div className="w-40">
                <Select value={settings.audioQuality} onValueChange={(v) => updateSettings({ autoplay: settings.autoplay, audioQuality: v as any })}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        {/* Logout */}
        <section className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 md:p-6 mb-4">
          <Button
            onClick={onLogout}
            variant="outline"
            className="w-full bg-red-500/5 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="w-5 h-5 mr-2" />
            Cerrar sesión
          </Button>
        </section>

        <section className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 md:p-6 mb-4">
          <div className="flex items-center gap-3 mb-5">
            <RotateCcw className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg md:text-xl font-bold text-white">Recomendaciones</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white font-medium text-sm md:text-base">Limpiar canciones vistas</p>
                <p className="text-xs md:text-sm text-zinc-500">Permite volver a ver recomendaciones ocultas por “vistas”.</p>
              </div>
              <Button
                onClick={() => {
                  setRecoSuccess(null);
                  setRecoError(null);
                  setRecoConfirm('');
                  setRecoAction('clear_seen');
                }}
                variant="outline"
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 text-sm"
              >
                Limpiar
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white font-medium text-sm md:text-base">Restablecer recomendaciones</p>
                <p className="text-xs md:text-sm text-zinc-500">Limpia tu caché y fuerza una regeneración en Home.</p>
              </div>
              <Button
                onClick={() => {
                  setRecoSuccess(null);
                  setRecoError(null);
                  setRecoConfirm('');
                  setRecoAction('clear_cache');
                }}
                variant="outline"
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 text-sm"
              >
                Restablecer
              </Button>
            </div>
            {recoSuccess && <p className="text-sm text-zinc-300">{recoSuccess}</p>}
          </div>
        </section>

        <section className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 md:p-6 mb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-white font-medium text-sm md:text-base">Restablecer mis datos</p>
              <p className="text-xs md:text-sm text-zinc-500">
                Borra recientes, favoritos, playlists e historial de búsqueda de tu cuenta.
              </p>
            </div>
            <Button
              onClick={() => setShowReset(true)}
              variant="outline"
              className="bg-red-500/5 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              Restablecer
            </Button>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-6 text-center space-y-1.5">
          <div className="flex justify-center gap-4 text-sm text-zinc-500">
            <button className="hover:text-white transition-colors">Ayuda</button>
            <span>•</span>
            <button className="hover:text-white transition-colors">Términos</button>
            <span>•</span>
            <button className="hover:text-white transition-colors">Privacidad</button>
          </div>
          <p className="text-xs text-zinc-600">© 2026 Vibe. Todos los derechos reservados.</p>
        </div>
      </div>

      {showReset && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-lg m-4 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">Restablecer mis datos</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (resetSubmitting) return;
                  setShowReset(false);
                  setResetConfirm('');
                  setResetError(null);
                }}
              >
                ×
              </Button>
            </div>

            <p className="text-sm text-zinc-400 mb-4">
              Esto borrará tus datos de uso (recientes, favoritos, playlists e historial). No elimina tu cuenta.
            </p>

            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4 mb-4">
              {resetLoading ? (
                <p className="text-sm text-zinc-400">Cargando vista previa...</p>
              ) : resetPreview ? (
                <div className="space-y-3">
                  <div className="text-xs text-zinc-500">
                    <div>Postgres: {(resetPreview.targets?.postgresTables || []).join(', ') || '—'}</div>
                    <div>Firestore: {(resetPreview.targets?.firestoreCollections || []).join(', ') || '—'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-zinc-300">Recientes: {resetPreview.deleted?.recent ?? 0}</div>
                    <div className="text-zinc-300">Favoritos: {resetPreview.deleted?.likes ?? 0}</div>
                    <div className="text-zinc-300">Playlists: {resetPreview.deleted?.playlists ?? 0}</div>
                    <div className="text-zinc-300">Canciones en playlists: {resetPreview.deleted?.playlistItems ?? 0}</div>
                    <div className="text-zinc-300">Búsquedas: {resetPreview.deleted?.searchHistory ?? 0}</div>
                    <div className="text-zinc-300">Ajustes: {resetPreview.deleted?.settings ?? 0}</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-400">No hay vista previa disponible.</p>
              )}
            </div>

            <div className="space-y-2 mb-4">
              <p className="text-xs text-zinc-500">Escribe {confirmText} para confirmar.</p>
              <input
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm"
                placeholder={confirmText}
                disabled={resetSubmitting}
              />
              {resetError && <p className="text-sm text-red-400">{resetError}</p>}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  if (resetSubmitting) return;
                  setShowReset(false);
                  setResetConfirm('');
                  setResetError(null);
                }}
                disabled={resetSubmitting}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleResetData}
                disabled={!canReset || resetSubmitting}
                className="bg-red-500 hover:bg-red-400 text-black"
              >
                {resetSubmitting ? 'Restableciendo...' : 'Restablecer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {!!recoAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-lg m-4 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">
                {recoAction === 'clear_seen' ? 'Limpiar canciones vistas' : 'Restablecer recomendaciones'}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (recoSubmitting) return;
                  setRecoAction(null);
                  setRecoConfirm('');
                  setRecoError(null);
                }}
              >
                ×
              </Button>
            </div>

            <div className="flex items-start gap-3 mb-4">
              <EyeOff className="w-5 h-5 text-zinc-400 mt-0.5" />
              <p className="text-sm text-zinc-400">
                {recoAction === 'clear_seen'
                  ? 'Esto sólo borra las canciones marcadas como vistas en recomendaciones. No borra tus favoritos ni tus playlists.'
                  : 'Esto sólo borra tu caché de recomendaciones. Sirve para forzar una regeneración en Home.'}
              </p>
            </div>

            <div className="space-y-2 mb-4">
              <p className="text-xs text-zinc-500">Escribe {recoConfirmText} para confirmar.</p>
              <input
                value={recoConfirm}
                onChange={(e) => setRecoConfirm(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-md px-3 py-2 text-sm"
                placeholder={recoConfirmText}
                disabled={recoSubmitting}
              />
              {recoError && <p className="text-sm text-red-400">{recoError}</p>}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  if (recoSubmitting) return;
                  setRecoAction(null);
                  setRecoConfirm('');
                  setRecoError(null);
                }}
                disabled={recoSubmitting}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleRecoAction}
                disabled={!canSubmitReco || recoSubmitting}
                className="bg-red-500 hover:bg-red-400 text-black"
              >
                {recoSubmitting ? 'Aplicando...' : 'Confirmar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
