-- Drop tables in reverse order of creation to avoid foreign key constraints
DROP TABLE IF EXISTS UserRecommendationFeedback, UserSeenTracks, UserRecommendationCache, GlobalCatalogTracks, History, Likes, PlaylistSongs, Playlists, Music, Albums, Artists, Users, Downloads CASCADE;

-- Users Table
CREATE TABLE Users (
    id SERIAL PRIMARY KEY,
    firebase_uid VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    photo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Artists Table
CREATE TABLE Artists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

-- Albums Table
CREATE TABLE Albums (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist_id INTEGER REFERENCES Artists(id),
    release_date DATE,
    image_url TEXT
);

-- Music Table (antes Songs)
CREATE TABLE Music (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist_id INTEGER REFERENCES Artists(id),
    album_id INTEGER REFERENCES Albums(id),
    duration INTEGER NOT NULL,
    url TEXT NOT NULL,
    thumbnail TEXT
);

-- Playlists Table
CREATE TABLE Playlists (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES Users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- PlaylistSongs Junction Table (Many-to-Many)
CREATE TABLE PlaylistSongs (
    playlist_id INTEGER REFERENCES Playlists(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES Music(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, song_id)
);

-- Downloads Table (estandarizado)
CREATE TABLE Downloads (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    youtube_id VARCHAR(32),
    uploader TEXT,
    duration INTEGER,
    thumbnail TEXT,
    url TEXT NOT NULL,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('audio', 'video')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX downloads_youtube_id_mode_uidx
    ON Downloads (youtube_id, mode)
    WHERE youtube_id IS NOT NULL;

-- Likes Table (canciones marcadas como me gusta)
CREATE TABLE Likes (
    id SERIAL PRIMARY KEY,
    download_id INTEGER REFERENCES Downloads(id) ON DELETE CASCADE UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- History Table (historial de reproducciones)
CREATE TABLE History (
    id SERIAL PRIMARY KEY,
    download_id INTEGER REFERENCES Downloads(id) ON DELETE CASCADE,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE UserRecommendationCache (
    id SERIAL PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    profile_hash VARCHAR(64) NOT NULL,
    queries TEXT[],
    items JSONB NOT NULL,
    source TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE UNIQUE INDEX user_recommendation_cache_uidx
    ON UserRecommendationCache (firebase_uid, endpoint, profile_hash);
CREATE INDEX user_recommendation_cache_expires_idx
    ON UserRecommendationCache (expires_at);

CREATE TABLE UserSeenTracks (
    id SERIAL PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    track_key TEXT NOT NULL,
    title_norm TEXT,
    artist_norm TEXT,
    reason TEXT,
    seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX user_seen_tracks_uidx
    ON UserSeenTracks (firebase_uid, track_key);
CREATE INDEX user_seen_tracks_seen_idx
    ON UserSeenTracks (firebase_uid, seen_at DESC);

CREATE TABLE GlobalCatalogTracks (
    id SERIAL PRIMARY KEY,
    youtube_id VARCHAR(32) UNIQUE,
    title TEXT NOT NULL,
    uploader TEXT,
    duration INTEGER,
    thumbnail TEXT,
    url TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX global_catalog_tracks_score_idx
    ON GlobalCatalogTracks (score DESC, updated_at DESC);

CREATE TABLE UserRecommendationFeedback (
    id SERIAL PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    track_key TEXT NOT NULL,
    youtube_id VARCHAR(32),
    title TEXT NOT NULL,
    artist TEXT,
    feedback_type TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX user_recommendation_feedback_uidx
    ON UserRecommendationFeedback (firebase_uid, track_key, feedback_type);
CREATE INDEX user_recommendation_feedback_uid_idx
    ON UserRecommendationFeedback (firebase_uid, created_at DESC);
