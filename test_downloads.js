const payload = {
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Rick Astley',
  uploader: 'RickAstleyVEVO',
  mode: 'audio',
  quality: 'high',
  youtube_id: 'dQw4w9WgXcQ'
};

fetch('http://localhost:3000/api/downloads', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
})
.then(async (res) => {
  console.log('Status:', res.status);
  console.log('Body:', await res.text());
})
.catch(console.error);
