import * as admin from 'firebase-admin';

const tryInitFirebaseAdmin = () => {
  if (admin.apps.length > 0) return;

  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonEnv) {
    try {
      const parsed = JSON.parse(jsonEnv);
      admin.initializeApp({ credential: admin.credential.cert(parsed) });
      console.log('[firebase] initialized from FIREBASE_SERVICE_ACCOUNT_JSON');
      return;
    } catch (error) {
      console.error('[firebase] failed to initialize from FIREBASE_SERVICE_ACCOUNT_JSON', error);
    }
  }

  const pathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (pathEnv) {
    try {
      const serviceAccount = require(pathEnv);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('[firebase] initialized from FIREBASE_SERVICE_ACCOUNT_PATH');
      return;
    } catch (error) {
      console.error('[firebase] failed to initialize from FIREBASE_SERVICE_ACCOUNT_PATH', error);
    }
  }

  try {
    const serviceAccount = require('../cla2.json');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[firebase] initialized from ../cla2.json');
    return;
  } catch (error) {
    console.error('[firebase] service account not found (../cla2.json) and no env configured; auth will be unavailable', error);
  }

  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log('[firebase] initialized from application default credentials');
  } catch (error) {
    console.error('[firebase] failed to initialize from application default credentials; auth will be unavailable', error);
  }
};

tryInitFirebaseAdmin();

export { admin };
