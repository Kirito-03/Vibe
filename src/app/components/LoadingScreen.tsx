import { motion } from 'motion/react';

export function LoadingScreen() {
  return (
    <div className="h-screen w-full bg-gradient-to-br from-violet-950 via-black to-fuchsia-950/30 flex items-center justify-center overflow-hidden">
      {/* Background animated orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute w-96 h-96 rounded-full bg-violet-600/10 blur-[100px]"
          animate={{ x: [0, 100, 0], y: [0, -50, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ top: '10%', left: '20%' }}
        />
        <motion.div
          className="absolute w-80 h-80 rounded-full bg-fuchsia-600/10 blur-[100px]"
          animate={{ x: [0, -80, 0], y: [0, 60, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          style={{ bottom: '15%', right: '15%' }}
        />
      </div>

      <div className="text-center relative z-10">
        {/* Logo */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 120 }}
          className="mb-8"
        >
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-2xl shadow-violet-500/30">
            <img src="/ico.png" alt="Logo" className="w-20 h-20 object-contain" />
          </div>
        </motion.div>
        
        {/* Title */}
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-300 via-fuchsia-300 to-violet-300 bg-clip-text text-transparent mb-2">
            Vibe
          </h1>
          <p className="text-sm text-zinc-500 tracking-widest uppercase">Tu mundo musical</p>
        </motion.div>

        {/* Equalizer bars */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="flex gap-1 justify-center mt-8 items-end h-8"
        >
          {[0, 0.1, 0.2, 0.3, 0.4].map((delay, i) => (
            <motion.div
              key={i}
              animate={{ height: ['8px', `${20 + i * 4}px`, '8px'] }}
              transition={{ repeat: Infinity, duration: 0.7, delay, ease: 'easeInOut' }}
              className="w-1 rounded-full bg-gradient-to-t from-violet-500 to-fuchsia-400"
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
