// ── Firebase init & Google auth ───────────────────────────────────────────────

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

function signIn() {
  auth.signInWithPopup(provider).catch(err => {
    showToast('Sign-in failed: ' + err.message, 'error');
  });
}

function signOut() {
  auth.signOut();
}

// Exposed so other modules can call auth.currentUser
