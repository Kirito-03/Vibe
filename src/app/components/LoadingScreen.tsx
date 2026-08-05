import { motion } from 'motion/react';

export function LoadingScreen() {
  return (
    <div 
      className="h-screen w-full flex flex-col items-center justify-center relative overflow-hidden" 
      style={{ background: 'linear-gradient(168deg, #1e0a3c 0%, #080010 100%)' }}
    >
      {/* Background scattered notes (similar to login page) */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <motion.span 
          className="absolute text-3xl text-purple-300" 
          animate={{ y: [0, -15, 0], opacity: [0.5, 0.8, 0.5] }} 
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} 
          style={{ top: '25%', left: '20%', rotate: '12deg' }}
        >♪</motion.span>
        <motion.span 
          className="absolute text-5xl text-purple-300" 
          animate={{ y: [0, -25, 0], opacity: [0.3, 0.7, 0.3] }} 
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 1 }} 
          style={{ top: '65%', left: '15%', rotate: '-15deg' }}
        >♫</motion.span>
        <motion.span 
          className="absolute text-2xl text-purple-300" 
          animate={{ y: [0, -12, 0], opacity: [0.4, 0.9, 0.4] }} 
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }} 
          style={{ top: '35%', right: '25%', rotate: '25deg' }}
        >♩</motion.span>
        <motion.span 
          className="absolute text-4xl text-purple-300" 
          animate={{ y: [0, -20, 0], opacity: [0.6, 1, 0.6] }} 
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 2 }} 
          style={{ bottom: '25%', right: '20%', rotate: '-8deg' }}
        >♬</motion.span>
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo and Brand */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center gap-6 mb-12"
        >
          <img src="/ico.png" alt="Vibe" className="w-20 h-20 filter brightness-200" />
          <span className="text-4xl font-bold text-white tracking-[8px]">VIBE</span>
        </motion.div>

        {/* Equalizer Loader */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.8 }}
          className="flex items-end gap-1.5 h-16"
        >
          {[...Array(14)].map((_, i) => (
            <motion.div
              key={i}
              className={`w-2 rounded-full ${i % 2 === 0 ? 'bg-fuchsia-500' : 'bg-purple-400'}`}
              animate={{ height: ['8px', '48px', '8px'] }}
              transition={{
                duration: 1 + Math.random() * 0.6,
                repeat: Infinity,
                delay: i * 0.1,
                ease: "easeInOut"
              }}
            />
          ))}
        </motion.div>
        
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="text-purple-300/60 text-sm tracking-[3px] uppercase mt-8 font-semibold"
        >
          Tu música, tu momento
        </motion.p>
      </div>
    </div>
  );
}
