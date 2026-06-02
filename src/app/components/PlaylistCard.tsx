import { Play } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';

interface PlaylistCardProps {
  title: string;
  description: string;
  imageUrl: string;
  onClick?: () => void;
}

export function PlaylistCard({ title, description, imageUrl, onClick }: PlaylistCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div 
      className="bg-zinc-900 p-4 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer group relative"
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div className="relative mb-4">
        <div className="aspect-square rounded-md overflow-hidden bg-zinc-700 shadow-lg">
          <img 
            src={imageUrl} 
            alt={title}
            className="w-full h-full object-cover"
          />
        </div>
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ 
            opacity: isHovered ? 1 : 0,
            y: isHovered ? 0 : 10
          }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-2 right-2 w-12 h-12 bg-violet-500 rounded-full flex items-center justify-center shadow-lg hover:bg-violet-400 hover:scale-105 transition-all"
        >
          <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
        </motion.button>
      </div>
      <h3 className="text-white font-semibold mb-2 truncate">{title}</h3>
      <p className="text-zinc-400 text-sm line-clamp-2">{description}</p>
    </motion.div>
  );
}