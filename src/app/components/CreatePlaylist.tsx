import { useEffect, useRef, useState } from 'react';
import { X, Image as ImageIcon, Music } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { useMusic } from '../context/MusicContext';
import { auth } from '../../firebaseConfig';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

interface CreatePlaylistProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreatePlaylist({ isOpen, onClose }: CreatePlaylistProps) {
  const [playlistName, setPlaylistName] = useState('');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createPlaylist } = useMusic();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const handleCreate = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setIsSubmitting(true);
    setError(null);
    try {
      let image_url: string | undefined;
      const trimmedImageUrl = imageUrl.trim();
      if (trimmedImageUrl) {
        image_url = trimmedImageUrl;
      }
      if (imageFile) {
        const storage = getStorage();
        const safeName = imageFile.name.replace(/[^\w.\-]+/g, '_');
        const storageRef = ref(storage, `users/${currentUser.uid}/playlists/${Date.now()}-${safeName}`);
        await uploadBytes(storageRef, imageFile);
        image_url = await getDownloadURL(storageRef);
      }
      await createPlaylist({ name: playlistName, description, image_url });
      setPlaylistName('');
      setDescription('');
      setImageFile(null);
      setImageUrl('');
      onClose();
    } catch {
      setError('No se pudo crear la playlist. Inténtalo de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Crear playlist</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Crea una nueva playlist para organizar tu música
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Image Upload */}
          <div className="flex gap-6">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-40 h-40 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-zinc-700 transition-colors group overflow-hidden"
            >
              {imagePreview || imageUrl.trim() ? (
                <img src={imagePreview || imageUrl.trim()} alt="Imagen de playlist" className="w-full h-full object-cover" />
              ) : (
                <div className="text-center">
                  <ImageIcon className="w-12 h-12 text-zinc-600 mx-auto mb-2 group-hover:text-zinc-400 transition-colors" />
                  <p className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">
                    Elegir imagen
                  </p>
                </div>
              )}
            </button>
            
            <div className="flex-1 space-y-4">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setImageFile(file);
                  setError(null);
                }}
              />
              <div>
                <label htmlFor="playlistName" className="block text-sm font-medium text-zinc-300 mb-2">
                  Nombre
                </label>
                <Input
                  id="playlistName"
                  type="text"
                  placeholder="Mi playlist"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label htmlFor="playlistImageUrl" className="block text-sm font-medium text-zinc-300 mb-2">
                  URL de imagen
                </label>
                <Input
                  id="playlistImageUrl"
                  type="url"
                  placeholder="https://..."
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    if (imageFile) setImageFile(null);
                    setError(null);
                  }}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-zinc-300 mb-2">
              Descripción
            </label>
            <Textarea
              id="description"
              placeholder="Añade una descripción opcional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 resize-none h-24"
              disabled={isSubmitting}
            />
          </div>

          {/* Privacy Note */}
          <div className="bg-zinc-800/50 rounded-lg p-4 flex gap-3">
            <Music className="w-5 h-5 text-violet-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-zinc-400">
              Cuando crees una playlist, aparecerá en tu biblioteca y en tu perfil
            </p>
          </div>
        </div>

        {error && (
          <div className="text-red-500 text-sm text-center bg-red-900/20 border border-red-500/30 rounded-md p-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="bg-transparent border-zinc-700 text-white hover:bg-zinc-800"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!playlistName.trim() || isSubmitting}
            className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Creando...' : 'Crear'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
