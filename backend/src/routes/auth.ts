import { Router } from 'express';
import { admin } from '../firebase';
import pool from '../db';

const router = Router();

// Verify Firebase token and create/update user in DB
router.post('/login', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const { uid, email } = decodedToken;

    // Check if user exists in our DB
    let user = await pool.query('SELECT * FROM Users WHERE firebase_uid = $1', [uid]);

    if (user.rows.length === 0) {
      // If not, create a new user
      const newUser = await pool.query(
        'INSERT INTO Users (firebase_uid, email) VALUES ($1, $2) RETURNING id, email, firebase_uid',
        [uid, email]
      );
      user = newUser;
    }

    res.status(200).json(user.rows[0]);
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
});

export default router;
