import { useState } from 'react';
import { MoreHorizontal, ThumbsUp, Ban, UserX } from 'lucide-react';
import { apiSendRecommendationFeedback } from '../api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type FeedbackType = 'more_like_this' | 'not_this_track' | 'not_this_artist';

type TrackLike = {
  id?: string | number;
  youtube_id?: string | number | null;
  title?: string | null;
  artist?: string | null;
  uploader?: string | null;
  source?: string | null;
};

export function TrackFeedbackMenu({
  track,
  onApplied,
  className,
}: {
  track: TrackLike;
  onApplied?: (feedbackType: FeedbackType) => void;
  className?: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const safeTrack = {
    id: track?.id ?? null,
    youtube_id: track?.youtube_id ?? null,
    title: track?.title ?? '',
    artist: track?.artist ?? track?.uploader ?? null,
    uploader: track?.uploader ?? track?.artist ?? null,
    source: track?.source ?? null,
  };

  const apply = async (feedbackType: FeedbackType) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiSendRecommendationFeedback({ track: safeTrack, feedbackType });
      if (!res.ok) return;
      onApplied?.(feedbackType);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className || 'rounded-full bg-black/50 hover:bg-black/70 text-white p-1.5 backdrop-blur-sm'}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label="Opciones"
          disabled={isSubmitting}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            apply('more_like_this');
          }}
        >
          <ThumbsUp className="w-4 h-4" />
          Más como esta
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            apply('not_this_track');
          }}
        >
          <Ban className="w-4 h-4" />
          No recomendar esta canción
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            apply('not_this_artist');
          }}
        >
          <UserX className="w-4 h-4" />
          No recomendar este artista
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
