type LoadErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
  isLoading?: boolean;
};

export const LoadErrorState = ({ title, message, onRetry, isLoading }: LoadErrorStateProps) => {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-sm font-semibold text-white">{title || 'No pudimos cargar esta sección'}</p>
      <p className="mt-1 text-xs text-white/60">{message || 'Intenta nuevamente en unos segundos'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={isLoading}
          className="mt-3 inline-flex items-center justify-center rounded-full bg-violet-500/20 px-4 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/30 transition-colors disabled:opacity-60"
        >
          {isLoading ? 'Cargando...' : 'Reintentar'}
        </button>
      )}
    </div>
  );
};
