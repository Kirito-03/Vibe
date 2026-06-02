import { Heart, Play, Pause } from 'lucide-react';
import { useState } from 'react';

interface SongRowProps {
  index: number;
  title: string;
  artist: string;
  album: string;
  duration: string;
  imageUrl: string;
  isPlaying?: boolean;
  isActive?: boolean;
  onClick?: () => void;
}

export function SongRow({ index, title, artist, album, duration, imageUrl, isPlaying, isActive, onClick }: SongRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isLiked, setIsLiked] = useState(false);

  return (
    <div 
      className={`grid grid-cols-[16px_4fr_2fr_1fr] gap-4 px-4 py-2 hover:bg-zinc-800/50 rounded group items-center text-zinc-400 cursor-pointer transition-all ${isActive ? 'bg-white/10' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div className="flex items-center justify-center">
        {isHovered ? (
          <button className="text-white">
            {isPlaying ? (
              <Pause className="w-4 h-4" fill="currentColor" />
            ) : (
              <Play className="w-4 h-4" fill="currentColor" />
            )}
          </button>
        ) : isActive && isPlaying ? (
          <div className="flex items-end justify-center gap-[2px] h-4">
            <div className="eq-bar h-2" />
            <div className="eq-bar h-4" />
            <div className="eq-bar h-3" />
            <div className="eq-bar h-4" />
          </div>
        ) : isActive ? (
          <span className="text-violet-400 text-xs">♫</span>
        ) : (
          <span className="text-sm">{index}</span>
        )}
      </div>
      
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-zinc-700 rounded overflow-hidden flex-shrink-0">
          <img 
            src={imageUrl} 
            alt={title}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="min-w-0">
          <div className={`truncate ${isActive ? 'text-violet-400' : 'text-white'}`}>{title}</div>
          <div className="text-sm truncate">{artist === 'YouTube' ? 'Internet' : artist}</div>
        </div>
      </div>
      
      <div className="truncate text-sm">{album}</div>
      
      <div className="flex items-center justify-between">
        <button
          onClick={(e) => { e.stopPropagation(); setIsLiked(!isLiked); }}
          className={`transition-all hover:scale-110 active:scale-95 ${isLiked ? 'text-fuchsia-500 opacity-100' : 'opacity-0 group-hover:opacity-100 hover:text-white'}`}
        >
          <Heart className="w-4 h-4" fill={isLiked ? 'currentColor' : 'none'} />
        </button>
        <span className="text-sm">{duration}</span>
      </div>
    </div>
  );
}
