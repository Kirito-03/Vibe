-- Migración: alinear schema con VPS

DO $$
BEGIN
  IF to_regclass('public.songs') IS NOT NULL AND to_regclass('public.music') IS NULL THEN
    EXECUTE 'ALTER TABLE Songs RENAME TO Music';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.downloads') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='artist')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='uploader') THEN
      EXECUTE 'ALTER TABLE Downloads RENAME COLUMN artist TO uploader';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='duration_seconds')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='duration') THEN
      EXECUTE 'ALTER TABLE Downloads RENAME COLUMN duration_seconds TO duration';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='thumbnail_url')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='thumbnail') THEN
      EXECUTE 'ALTER TABLE Downloads RENAME COLUMN thumbnail_url TO thumbnail';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='file_path')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='url') THEN
      EXECUTE 'ALTER TABLE Downloads RENAME COLUMN file_path TO url';
    END IF;
  END IF;
END $$;

-- Migración: alinear tabla Downloads (estandarizado)
CREATE TABLE IF NOT EXISTS Downloads (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    youtube_id VARCHAR(32),
    uploader TEXT,
    duration INTEGER,
    thumbnail TEXT,
    url TEXT,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('audio', 'video')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE Downloads
ADD COLUMN IF NOT EXISTS youtube_id VARCHAR(32);

ALTER TABLE Downloads
ADD COLUMN IF NOT EXISTS uploader TEXT;

ALTER TABLE Downloads
ADD COLUMN IF NOT EXISTS duration INTEGER;

ALTER TABLE Downloads
ADD COLUMN IF NOT EXISTS thumbnail TEXT;

ALTER TABLE Downloads
ADD COLUMN IF NOT EXISTS url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS downloads_youtube_id_mode_uidx
ON Downloads (youtube_id, mode)
WHERE youtube_id IS NOT NULL;
