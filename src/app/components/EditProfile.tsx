import { useState, useRef } from 'react';
import { User, updateProfile } from 'firebase/auth';
import { auth, db } from '../../firebaseConfig';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { X, Camera } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

interface EditProfileProps {
  user: User;
  onClose: () => void;
  onProfileUpdate: (user: User) => void;
}

export const EditProfile: React.FC<EditProfileProps> = ({ user, onClose, onProfileUpdate }) => {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || '');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!auth.currentUser) return;
    const apiKey = import.meta.env.VITE_IMGBB_KEY as string | undefined;
    if (!apiKey) {
      setError('Falta configurar VITE_IMGBB_KEY');
      return;
    }
    const form = new FormData();
    form.append('image', file);
    setIsUploadingPhoto(true);
    setError(null);
    fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      body: form,
    })
      .then((r) => r.json())
      .then(async (data) => {
        const url = String(data?.data?.url || '');
        if (!url) throw new Error('imgbb');
        await updateProfile(auth.currentUser!, { photoURL: url });
        await setDoc(
          doc(db, 'users', auth.currentUser!.uid),
          { photo_url: url, updated_at: serverTimestamp() },
          { merge: true }
        );
        setPhotoURL(url);
        onProfileUpdate(auth.currentUser!);
      })
      .catch(() => setError('No se pudo subir la foto. Inténtalo de nuevo.'))
      .finally(() => {
        setIsUploadingPhoto(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await updateProfile(auth.currentUser, {
        displayName,
      });

      await setDoc(
        doc(db, 'users', auth.currentUser.uid),
        { display_name: displayName, updated_at: serverTimestamp() },
        { merge: true }
      );
      
      onProfileUpdate(auth.currentUser);
      onClose();

    } catch (err) {
      setError('No se pudo actualizar el perfil. Inténtalo de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md m-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Editar Perfil</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col items-center mb-6">
            <div className="relative w-24 h-24 rounded-full mb-4">
              <img
                src={photoURL || `https://ui-avatars.com/api/?name=${user.displayName || user.email}&background=27272a&color=fff`}
                alt="Avatar"
                className="w-full h-full rounded-full object-cover"
              />
              {isUploadingPhoto && (
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 bg-violet-500 rounded-full p-2 hover:bg-violet-600"
                disabled={isUploadingPhoto}
              >
                <Camera className="w-4 h-4 text-white" />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handlePhotoChange}
                className="hidden"
                accept="image/*"
              />
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-zinc-400 mb-1">
                Nombre de usuario
              </label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-zinc-800 border-zinc-700"
              />
            </div>
          </div>
          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
          <div className="mt-6 flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || isUploadingPhoto}>
              {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
