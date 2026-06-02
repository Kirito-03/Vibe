import { useMemo, useState } from 'react';
import { Music2 } from 'lucide-react';

type TrackCoverProps = {
  src?: string | null;
  videoId?: string | null;
  title?: string;
  className?: string;
};

const ytCover = (videoId: string, quality: 'hq' | 'mq') =>
  `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${quality === 'hq' ? 'hqdefault' : 'mqdefault'}.jpg`;

export const TrackCover = ({ src, videoId, title = '', className }: TrackCoverProps) => {
  const initialSrc = useMemo(() => {
    const s = typeof src === 'string' ? src.trim() : '';
    if (s) return s;
    const vid = typeof videoId === 'string' ? videoId.trim() : '';
    if (vid) return ytCover(vid, 'hq');
    return '';
  }, [src, videoId]);

  const fallbacks = useMemo(() => {
    const out: string[] = [];
    const vid = typeof videoId === 'string' ? videoId.trim() : '';
    if (vid) {
      if (initialSrc !== ytCover(vid, 'hq')) out.push(ytCover(vid, 'hq'));
      out.push(ytCover(vid, 'mq'));
    }
    return out;
  }, [initialSrc, videoId]);

  const [value, setValue] = useState(initialSrc);
  const [idx, setIdx] = useState(0);

  const onError = () => {
    if (idx < fallbacks.length) {
      setValue(fallbacks[idx]);
      setIdx((p) => p + 1);
      return;
    }
    setValue('');
  };

  if (!value) {
    return (
      <div className={className}>
        <div className="w-full h-full flex items-center justify-center bg-zinc-800">
          <Music2 className="w-7 h-7 text-zinc-500" />
        </div>
      </div>
    );
  }

  return <img src={value} alt={title} className={className} onError={onError} />;
};

