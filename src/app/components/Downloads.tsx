import { useState, useEffect, useRef } from 'react';
import { Search as SearchIcon, Download, Music2, Play, Pause, Clock, Loader2 } from 'lucide-react';
import { Input } from './ui/input';
import { auth } from '../../firebaseConfig';
import { apiFetch, API_BASE } from '../api';

interface Download {
  id: number | string;
  title: string;
  uploader?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  url?: string | null;
  artist?: string | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
  filename?: string;
  mode: 'audio' | 'video';
  created_at?: string;
}

// Mapea un Download al formato Song que espera el Player de App.tsx
export function downloadToSong(d: Download) {
  const dur = d.duration ?? d.duration_seconds ?? 0;
  const m = Math.floor(dur / 60);
  const s = dur % 60;
  
  // Forzamos la ruta al archivo MP3 seguro en tu backend local
  const localStreamUrl = `${API_BASE || ''}/api/downloads/stream/${d.id}`;
  const who = d.uploader ?? d.artist ?? 'Desconocido';
  const cover = d.thumbnail ?? d.thumbnail_url ?? undefined;

  return {
    id: `dl-${d.id}`,
    title: d.title,
    artist: who,
    artist_name: who,
    album: d.mode === 'audio' ? 'Audio' : 'Video',
    duration_seconds: dur,
    durationSecs: dur,
    duration: `${m}:${s.toString().padStart(2, '0')}`,
    file_url: localStreamUrl,
    url: localStreamUrl,        // EL SELLO DEFINITIVO: Sobrescribe cualquier URL de YouTube
    source: 'local',            // LA ORDEN ABSOLUTA: Le ordena al reproductor usar el archivo local
    image_url: cover,
    imageUrl: cover ?? 'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=200',
  };
}

function formatDuration(secs: number | null) {
  if (!secs) return '--:--';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface DownloadsProps {
  onSongPlay: (song: ReturnType<typeof downloadToSong>, playlist?: any) => void;
  currentSong: { id: number | string } | null;
  isPlaying: boolean;
}

export function Downloads({ onSongPlay, currentSong, isPlaying }: DownloadsProps) {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const [quality, setQuality] = useState('high');
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  // Cargar lista de downloads
  const fetchDownloads = async () => {
    try {
      const res = await apiFetch(`/api/downloads`);
      const data = await res.json();
      setDownloads(data);
    } catch (e) {
      console.error('Error cargando downloads:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDownloads(); }, []);

  // Filtro por búsqueda
  const filtered = downloads.filter((d) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      (d.uploader ?? d.artist ?? '').toLowerCase().includes(q)
    );
  });

  // Nueva descarga
  const handleDownload = async () => {
    if (!urlInput.trim()) return;
    setDownloading(true);
    setDownloadStatus('⏳ Descargando...');
    try {
      const res = await apiFetch(`/api/downloads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: urlInput.trim(), title: urlInput.trim(), mode, quality }),
      });
      if (!res.ok) {
        const err = await res.json();
        setDownloadStatus(`❌ ${err.error}`);
      } else {
        const data = await res.json();
        setDownloadStatus(`✅ Descargado: ${data.title}`);
        setUrlInput('');
        await fetchDownloads();
      }
    } catch (e) {
      setDownloadStatus('❌ Error de conexión');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-zinc-900 to-black p-4 md:p-6">

      {/* ── Header ── */}
      <div className="mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-1">Mis Descargas</h2>
        <p className="text-zinc-400 text-sm">Audio y video descargados desde YouTube</p>
      </div>

      {/* ── Formulario de nueva descarga ── */}
      <div className="bg-zinc-800/60 rounded-xl p-4 mb-6 border border-zinc-700/50">
        <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
          <Download className="w-4 h-4 text-violet-400" />
          Nueva descarga
        </h3>
        <div className="flex flex-col md:flex-row gap-3">
          <Input
            placeholder="https://youtube.com/watch?v=..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="flex-1 bg-zinc-700/60 border-zinc-600 text-white placeholder-zinc-400"
            onKeyDown={(e) => e.key === 'Enter' && handleDownload()}
          />
          <div className="flex gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'audio' | 'video')}
              className="bg-zinc-700 border border-zinc-600 text-white rounded-md px-3 py-2 text-sm"
            >
              <option value="audio">Audio (MP3)</option>
              <option value="video">Video (MP4)</option>
            </select>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="bg-zinc-700 border border-zinc-600 text-white rounded-md px-3 py-2 text-sm"
            >
              {mode === 'audio'
                ? (<><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></>)
                : (<><option value="best">Mejor</option><option value="1080p">1080p</option><option value="720p">720p</option><option value="480p">480p</option></>)
              }
            </select>
            <button
              onClick={handleDownload}
              disabled={downloading || !urlInput.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-600 disabled:cursor-not-allowed text-black font-semibold rounded-md text-sm transition-colors"
            >
              {downloading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />
              }
              {downloading ? 'Descargando...' : 'Descargar'}
            </button>
          </div>
        </div>
        {downloadStatus && (
          <p className="mt-2 text-sm text-zinc-300">{downloadStatus}</p>
        )}
      </div>

      {/* ── Buscador ── */}
      <div className="relative mb-4">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <Input
          placeholder="Buscar en tus descargas..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 bg-zinc-800/60 border-zinc-700 text-white placeholder-zinc-400"
        />
      </div>

      {/* ── Lista de downloads ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
          <Music2 className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-lg font-medium">
            {query ? 'Sin resultados' : 'No hay descargas aún'}
          </p>
          <p className="text-sm mt-1">
            {query ? 'Intenta con otro término' : 'Pega una URL de YouTube arriba para empezar'}
          </p>
        </div>
      ) : (
        <>
          {/* Header de columnas */}
          <div className="grid grid-cols-[2fr_1fr_1fr_60px] gap-4 px-4 py-2 text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800 mb-1">
            <span>Título</span>
            <span>Artista</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Duración</span>
            <span>Tipo</span>
          </div>

          <div className="space-y-1">
            {filtered.map((d) => {
              const song = downloadToSong(d);
              const isActive = currentSong?.id === song.id;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    const playlist = {
                      id: 'downloads',
                      name: 'Mis Descargas',
                      description: 'Música almacenada localmente',
                      image_url: '',
                      songs: filtered.map(downloadToSong)
                    };
                    onSongPlay(song, playlist);
                  }}
                  className={`grid grid-cols-[2fr_1fr_1fr_60px] gap-4 px-4 py-3 rounded-lg items-center cursor-pointer transition-all group
                    ${isActive ? 'bg-violet-500/10 border border-violet-500/20' : 'hover:bg-zinc-800/50'}`}
                >
                  {/* Thumbnail + título */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative w-10 h-10 flex-shrink-0 rounded-md overflow-hidden bg-zinc-700">
                      {(d.thumbnail ?? d.thumbnail_url) ? (
                        <img src={d.thumbnail ?? d.thumbnail_url ?? ''} alt={d.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music2 className="w-4 h-4 text-zinc-500" />
                        </div>
                      )}
                      {/* Play overlay al hover */}
                      <div className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity
                        ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isActive && isPlaying
                          ? <Pause className="w-4 h-4 text-white" fill="currentColor" />
                          : <Play className="w-4 h-4 text-white" fill="currentColor" />
                        }
                      </div>
                    </div>
                    <span className={`truncate text-sm font-medium ${isActive ? 'text-violet-400' : 'text-white'}`}>
                      {d.title}
                    </span>
                  </div>

                  <span className="truncate text-sm text-zinc-400">{d.uploader ?? d.artist ?? '—'}</span>
                  <span className="text-sm text-zinc-400">{formatDuration(d.duration ?? d.duration_seconds ?? null)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit
                    ${d.mode === 'audio' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
                    {d.mode === 'audio' ? 'MP3' : 'MP4'}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
