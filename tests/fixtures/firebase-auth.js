const service = () => globalThis.__fakeFirebase;
function user(uid, email) { return {uid, email, emailVerified: true, reload: async () => {}}; }
export function getAuth() { return service().auth; }
export function onAuthStateChanged(auth, callback) { auth.callback = callback; setTimeout(() => callback(auth.currentUser), 0); }
export async function createUserWithEmailAndPassword(auth, email) { auth.currentUser = user("new-user", email); auth.callback(auth.currentUser); return {user: auth.currentUser}; }
export async function signInWithEmailAndPassword(auth, email) { auth.currentUser = user("new-user", email); auth.callback(auth.currentUser); return {user: auth.currentUser}; }
export async function signOut(auth) { auth.currentUser = null; auth.callback(null); }
export async function sendEmailVerification() {}
export async function sendPasswordResetEmail() {}
