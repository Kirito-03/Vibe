-- Seed Artists
INSERT INTO Artists (name) VALUES ('The Weeknd'), ('Dua Lipa'), ('Daft Punk');

-- Seed Albums
INSERT INTO Albums (title, artist_id, release_date, image_url) VALUES
('After Hours', 1, '2020-03-20', 'https://images.unsplash.com/photo-1653473672408-5d2d68fa1278?w=100'),
('Future Nostalgia', 2, '2020-03-27', 'https://images.unsplash.com/photo-1761814684971-fa0e7fd606e2?w=100'),
('Discovery', 3, '2001-03-12', 'https://images.unsplash.com/photo-1703115015343-81b498a8c080?w=100');

-- Seed Music (antes Songs)
INSERT INTO Music (title, artist_id, album_id, duration, url, thumbnail) VALUES
('Blinding Lights', 1, 1, 204, '/music/blinding-lights.mp3', 'https://images.unsplash.com/photo-1653473672408-5d2d68fa1278?w=100'),
('Save Your Tears', 1, 1, 215, '/music/save-your-tears.mp3', 'https://images.unsplash.com/photo-1653473672408-5d2d68fa1278?w=100'),
('Levitating', 2, 2, 203, '/music/levitating.mp3', 'https://images.unsplash.com/photo-1761814684971-fa0e7fd606e2?w=100'),
('Starboy', 1, 1, 230, '/music/starboy.mp3', 'https://images.unsplash.com/photo-1653473672408-5d2d68fa1278?w=100'),
('One More Time', 3, 3, 320, '/music/one-more-time.mp3', 'https://images.unsplash.com/photo-1703115015343-81b498a8c080?w=100');

-- Seed a User (assuming a user has logged in and has an entry in the Users table)
-- Note: Replace 'some_firebase_uid' with a real UID after a user logs in for testing
-- INSERT INTO Users (firebase_uid, email, display_name) VALUES ('some_firebase_uid', 'test@example.com', 'Test User');

-- Seed Playlists (assign to the first user found)
INSERT INTO Playlists (user_id, name, description, image_url)
SELECT id, 'Chill Vibes', 'Perfect for relaxing and unwinding.', 'https://images.unsplash.com/photo-1516423752223-53332b2f6563?w=400' FROM Users LIMIT 1;

INSERT INTO Playlists (user_id, name, description, image_url)
SELECT id, 'Workout Hits', 'High-energy tracks to keep you motivated.', 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=400' FROM Users LIMIT 1;

-- Seed PlaylistSongs
INSERT INTO PlaylistSongs (playlist_id, song_id) VALUES
(1, 1), (1, 2), (1, 5),
(2, 3), (2, 4);
