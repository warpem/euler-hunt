import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, type User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBjsYPXE7YiCzIjqyYLsntZN3Vvg1AxkAE',
  authDomain: 'euler-hunt.firebaseapp.com',
  projectId: 'euler-hunt',
  storageBucket: 'euler-hunt.firebasestorage.app',
  messagingSenderId: '352257794807',
  appId: '1:352257794807:web:66d874df4fc5af5961e9f2',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser: User | null = null;

/** Sign in anonymously. Call once at app start. */
export async function initAuth(): Promise<void> {
  try {
    const cred = await signInAnonymously(auth);
    currentUser = cred.user;
  } catch (e) {
    console.warn('Firebase auth failed:', e);
  }
}

export function getUid(): string | null {
  return currentUser?.uid ?? null;
}

// --- Player name (localStorage) ---

const NAME_KEY = 'euler-hunt-name';

export function getPlayerName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function setPlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, name.slice(0, 8));
}

// --- Leaderboard ---

export interface LeaderboardEntry {
  uid: string;
  name: string;
  resolution: number;
}

export async function submitScore(
  levelSlug: string,
  name: string,
  resolution: number,
): Promise<void> {
  const uid = getUid();
  if (!uid) throw new Error('Not authenticated');

  // Round to 3 decimal places for storage
  resolution = Math.round(resolution * 1000) / 1000;

  const ref = doc(db, 'scores', levelSlug, 'entries', uid);

  // Check if existing score is already better
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const prev = existing.data().resolution as number;
    if (resolution >= prev) {
      // Current score is not an improvement — just update name if changed
      if (existing.data().name !== name) {
        await setDoc(ref, { name, resolution: prev, timestamp: serverTimestamp() });
      }
      return;
    }
  }

  await setDoc(ref, { name, resolution, timestamp: serverTimestamp() });
  setPlayerName(name);
}

export async function getLeaderboard(
  levelSlug: string,
  max = 20,
): Promise<LeaderboardEntry[]> {
  const q = query(
    collection(db, 'scores', levelSlug, 'entries'),
    orderBy('resolution', 'asc'),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    uid: d.id,
    name: d.data().name as string,
    resolution: d.data().resolution as number,
  }));
}

export async function getMyScore(
  levelSlug: string,
): Promise<LeaderboardEntry | null> {
  const uid = getUid();
  if (!uid) return null;
  const ref = doc(db, 'scores', levelSlug, 'entries', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return {
    uid: snap.id,
    name: snap.data().name as string,
    resolution: snap.data().resolution as number,
  };
}
