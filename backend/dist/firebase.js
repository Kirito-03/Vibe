"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.admin = void 0;
const admin = __importStar(require("firebase-admin"));
exports.admin = admin;
const tryInitFirebaseAdmin = () => {
    if (admin.apps.length > 0)
        return;
    const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (jsonEnv) {
        try {
            const parsed = JSON.parse(jsonEnv);
            admin.initializeApp({ credential: admin.credential.cert(parsed) });
            console.log('[firebase] initialized from FIREBASE_SERVICE_ACCOUNT_JSON');
            return;
        }
        catch (error) {
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
        }
        catch (error) {
            console.error('[firebase] failed to initialize from FIREBASE_SERVICE_ACCOUNT_PATH', error);
        }
    }
    try {
        const serviceAccount = require('../cla2.json');
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('[firebase] initialized from ../cla2.json');
        return;
    }
    catch (error) {
        console.error('[firebase] service account not found (../cla2.json) and no env configured; auth will be unavailable', error);
    }
    try {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
        console.log('[firebase] initialized from application default credentials');
    }
    catch (error) {
        console.error('[firebase] failed to initialize from application default credentials; auth will be unavailable', error);
    }
};
tryInitFirebaseAdmin();
