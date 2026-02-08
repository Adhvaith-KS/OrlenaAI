import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDhhnFnKhSWnDfhpL7zMhoCzKKFt8LcNj4",
    authDomain: "dehack-6c6f7.firebaseapp.com",
    databaseURL: "https://dehack-6c6f7-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "dehack-6c6f7",
    storageBucket: "dehack-6c6f7.firebasestorage.app",
    messagingSenderId: "604814263167",
    appId: "1:604814263167:web:c75439c8d6e719e0c5504a",
    measurementId: "G-RMKP2TNHKS"
};

// Initialize Firebase (singleton pattern for Next.js)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db };
