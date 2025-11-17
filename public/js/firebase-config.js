// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDe45MW127fBzHk4s7ps7mE1sFND3z_Fjk",
  authDomain: "muneco-8a8e9.firebaseapp.com",
  projectId: "muneco-8a8e9",
  storageBucket: "muneco-8a8e9.firebasestorage.app",
  messagingSenderId: "411191458352",
  appId: "1:411191458352:web:526f91aea1b4e937b54bf5",
  measurementId: "G-XFZ3WJ3H35"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

console.log('Firebase initialized successfully');
