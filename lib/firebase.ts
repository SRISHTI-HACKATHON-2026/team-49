import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAfAHYLD-3E9hl04BRCminCZVliptsqgOo",
  authDomain: "abcd-71ac4.firebaseapp.com",
  projectId: "abcd-71ac4",
  storageBucket: "abcd-71ac4.firebasestorage.app",
  messagingSenderId: "774117586671",
  appId: "1:774117586671:web:5d8286cd3a6fbf22b74d1a",
  measurementId: "G-1450CZ242W"
};

// Initialize Firebase only once
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider, signInWithEmailAndPassword, signInWithPopup };
