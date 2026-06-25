// ============================================================
// firebase-config.js  —  BilikBazası / MyMind Firebase inteqrasiyası
// ============================================================
// Layihə: mymind-60f6e
// Firestore + Analytics aktiv
// ============================================================

import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics }   from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ── Konfiqurasiya ────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCFDtFgNh3ABgQeRU-KR-PYqSmYq9ioht4",
  authDomain:        "mymind-60f6e.firebaseapp.com",
  projectId:         "mymind-60f6e",
  storageBucket:     "mymind-60f6e.firebasestorage.app",
  messagingSenderId: "805629779683",
  appId:             "1:805629779683:web:5e6d49ce1f9399eb16efd6",
  measurementId:     "G-EM6GF2QNGG",
};

// ── İnisializasiya ───────────────────────────────────────────
const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db        = getFirestore(app);

// ── Qeydlər (notes) ─────────────────────────────────────────

/** Qeyd saxla və ya yenilə */
window.FS_saveNote = async (note) => {
  await setDoc(doc(db, "notes", String(note.id)), note);
};

/** Qeyd sil */
window.FS_deleteNote = async (id) => {
  await deleteDoc(doc(db, "notes", String(id)));
};

// ── Kateqoriyalar (categories) ───────────────────────────────

/** Kateqoriya saxla və ya yenilə */
window.FS_saveCat = async (cat) => {
  await setDoc(doc(db, "categories", String(cat.id)), cat);
};

/** Kateqoriya sil */
window.FS_deleteCat = async (id) => {
  await deleteDoc(doc(db, "categories", String(id)));
};

// ── Əlaqələr (links) ─────────────────────────────────────────

/** İki qeyd arasında əlaqə saxla */
window.FS_saveLink = async (a, b) => {
  const id = `${Math.min(a, b)}_${Math.max(a, b)}`;
  await setDoc(doc(db, "links", id), { a, b });
};

/** Əlaqəni sil */
window.FS_deleteLink = async (a, b) => {
  const id = `${Math.min(a, b)}_${Math.max(a, b)}`;
  await deleteDoc(doc(db, "links", id));
};

// ── Toplu yükləmə ────────────────────────────────────────────

/**
 * Bütün məlumatları bir dəfəyə yüklə (tətbiq ilk açıldıqda çağır).
 * @returns {{ categories, notes, links }}
 */
window.FS_loadAll = async () => {
  const [catsSnap, notesSnap, linksSnap] = await Promise.all([
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "notes")),
    getDocs(collection(db, "links")),
  ]);
  return {
    categories: catsSnap.docs.map((d) => d.data()),
    notes:      notesSnap.docs.map((d) => d.data()),
    links:      linksSnap.docs.map((d) => d.data()),
  };
};

// ── Real-time dinləmə ────────────────────────────────────────

/**
 * Qeydləri real vaxtda dinlə.
 * @param {(notes: object[]) => void} callback
 * @returns {() => void}  — dinləməni dayandıran funksiya
 */
window.FS_listenNotes = (callback) => {
  return onSnapshot(collection(db, "notes"), (snap) => {
    callback(snap.docs.map((d) => d.data()));
  });
};

/**
 * Kateqoriyaları real vaxtda dinlə.
 * @param {(cats: object[]) => void} callback
 * @returns {() => void}
 */
window.FS_listenCats = (callback) => {
  return onSnapshot(collection(db, "categories"), (snap) => {
    callback(snap.docs.map((d) => d.data()));
  });
};

// ── Hazır ────────────────────────────────────────────────────
console.log("[BilikBazası] Firebase uğurla qoşuldu ✓  (mymind-60f6e)");
