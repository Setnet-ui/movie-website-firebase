class MovieApp {
    constructor() {
        this.currentUser = null;
        this.movies = [];
        this.currentFile = null;
        this.init();
    }

    async init() {
        await this.setupAuth();
        this.setupEventListeners();
        await this.loadMovies();
        console.log('MovieApp initialized');
    }

    // Authentication Methods
    async setupAuth() {
        return new Promise((resolve) => {
            firebase.auth().onAuthStateChanged((user) => {
                this.currentUser = user;
                this.updateAuthUI();
                resolve();
            });
        });
    }

    updateAuthUI() {
        const authButtons = document.getElementById('auth-buttons');
        if (this.currentUser) {
            authButtons.innerHTML = `
                <div class="user-info">
                    <span class="text-muted">Welcome, ${this.currentUser.email}</span>
                    <button onclick="app.logout()" class="btn btn-outline">Logout</button>
                </div>
            `;
        } else {
            authButtons.innerHTML = '<button id="login-btn" class="btn btn-outline">Login</button>';
            document.getElementById('login-btn').addEventListener('click', () => this.showLoginModal());
        }
    }

    async login(email, password) {
        try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            this.hideAuthModals();
            this.showNotification('Login successful!', 'success');
        } catch (error) {
            this.showNotification('Login failed: ' + error.message, 'error');
        }
    }

    async register(email, password, confirmPassword) {
        if (password !== confirmPassword) {
            this.showNotification('Passwords do not match', 'error');
            return;
        }
        try {
            await firebase.auth().createUserWithEmailAndPassword(email, password);
            this.hideAuthModals();
            this.showNotification('Registration successful!', 'success');
        } catch (error) {
            this.showNotification('Registration failed: ' + error.message, 'error');
        }
    }

    async logout() {
        try {
            await firebase.auth().signOut();
            this.showNotification('Logged out successfully', 'success');
        } catch (error) {
            this.showNotification('Logout failed: ' + error.message, 'error');
        }
    }

    // Movie Management
    async loadMovies() {
        try {
            const snapshot = await db.collection('movies')
                .orderBy('createdAt', 'desc')
                .get();
            this.movies = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            this.renderMovies();
        } catch (error) {
            console.error('Error loading movies:', error);
            this.showNotification('Failed to load movies', 'error');
        }
    }

    renderMovies() {
        const grid = document.getElementById('movies-grid');
        if (this.movies.length === 0) {
            grid.innerHTML = `
                <div class="text-center">
                    <p class="text-muted">No movies available yet.</p>
                    <p class="text-muted">Be the first to upload a movie!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.movies.map(movie => `
            <div class="movie-card">
                <div class="movie-poster">
                    ${movie.thumbnailURL 
                        ? `<img src="${movie.thumbnailURL}" alt="${this.escapeHtml(movie.title)}" />` 
                        : `<i class="fas fa-film fa-3x"></i>`}
                </div>
                <div class="movie-info">
                    <h3 class="movie-title">${this.escapeHtml(movie.title)}</h3>
                    <p class="movie-description">${this.escapeHtml(movie.description)}</p>
                    <div class="movie-meta">
                        <span>${this.formatFileSize(movie.fileSize)}</span>
                        <span>${this.formatDate(movie.createdAt)}</span>
                    </div>
                    <button onclick="app.downloadMovie('${movie.id}')" 
                            class="btn btn-primary btn-block"
                            ${!this.currentUser ? 'disabled' : ''}>
                        <i class="fas fa-download"></i> 
                        ${this.currentUser ? 'Download' : 'Login to Download'}
                    </button>
                </div>
            </div>
        `).join('');
    }

    async downloadMovie(movieId) {
        if (!this.currentUser) {
            this.showNotification('Please login to download movies', 'error');
            return;
        }

        try {
            const movie = this.movies.find(m => m.id === movieId);
            if (!movie) throw new Error('Movie not found');

            const downloadURL = await storage.ref(movie.filePath).getDownloadURL();
            const link = document.createElement('a');
            link.href = downloadURL;
            link.download = movie.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            await db.collection('movies').doc(movieId).update({
                downloadCount: firebase.firestore.FieldValue.increment(1)
            });

            this.showNotification('Download started!', 'success');
        } catch (error) {
            console.error('Download error:', error);
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    async uploadMovie(movieData, file) {
        if (!this.currentUser) {
            this.showNotification('Please login to upload movies', 'error');
            return;
        }

        try {
            const movieId = db.collection('movies').doc().id;
            const filePath = `movies/${movieId}/${file.name}`;
            const storageRef = storage.ref(filePath);

            const uploadProgress = document.getElementById('upload-progress');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');

            uploadProgress.style.display = 'block';

            // Generate thumbnail blob
            const thumbnailBlob = await this.generateThumbnailBlob(file);
            const thumbPath = `movies/${movieId}/thumbnail.jpg`;
            const thumbRef = storage.ref(thumbPath);
            const thumbSnapshot = await thumbRef.put(thumbnailBlob);
            const thumbnailURL = await thumbSnapshot.ref.getDownloadURL();

            const uploadTask = storageRef.put(file);

            uploadTask.on('state_changed',
                snapshot => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    progressFill.style.width = progress + '%';
                    progressText.textContent = `Uploading: ${Math.round(progress)}%`;
                },
                error => { throw error; },
                async () => {
                    const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();

                    await db.collection('movies').doc(movieId).set({
                        title: movieData.title,
                        description: movieData.description,
                        filename: file.name,
                        filePath: filePath,
                        fileSize: file.size,
                        downloadURL: downloadURL,
                        thumbnailURL: thumbnailURL,
                        downloadCount: 0,
                        uploadedBy: this.currentUser.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    this.cancelUpload();
                    this.showNotification('Movie uploaded successfully!', 'success');
                    this.navigateToSection('movies');
                }
            );

        } catch (error) {
            console.error('Upload error:', error);
            this.showNotification('Upload failed: ' + error.message, 'error');
        }
    }

    generateThumbnailBlob(file) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.src = URL.createObjectURL(file);

            video.onloadeddata = () => {
                video.currentTime = 1;
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 320;
                canvas.height = 180;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    resolve(blob);
                }, 'image/jpeg', 0.7);
                URL.revokeObjectURL(video.src);
            };

            video.onerror = () => reject('Failed to generate thumbnail');
        });
    }

    // UI Methods
    setupEventListeners() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const target = e.target.getAttribute('href').substring(1);
                this.navigateToSection(target);
            });
        });

        document.getElementById('explore-btn').addEventListener('click', () => {
            this.navigateToSection('movies');
        });

        const fileInput = document.getElementById('file-input');
        const uploadArea = document.getElementById('upload-area');

        fileInput.addEventListener('change', e => this.handleFileSelect(e.target.files[0]));

        uploadArea.addEventListener('dragover', e => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', e => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            this.handleFileSelect(e.dataTransfer.files[0]);
        });

        document.getElementById('movie-form').addEventListener('submit', e => {
            e.preventDefault();
            this.submitMovieForm();
        });

        document.getElementById('search-input').addEventListener('input', e => this.filterMovies(e.target.value));
        this.setupAuthModals();
    }

    handleFileSelect(file) {
        if (!file) return;
        const allowedTypes = ['video/mp4', 'video/avi', 'video/x-matroska', 'video/quicktime'];
        if (!allowedTypes.includes(file.type)) {
            this.showNotification('Please select a valid video file (MP4, AVI, MKV, MOV)', 'error');
            return;
        }

        const maxSize = 2 * 1024 * 1024 * 1024;
        if (file.size > maxSize) {
            this.showNotification('File size must be less than 2GB', 'error');
            return;
        }

        this.currentFile = file;
        document.getElementById('upload-area').style.display = 'none';
        document.getElementById('movie-form').style.display = 'block';
        document.getElementById('file-name').textContent = file.name;
    }

    async submitMovieForm() {
        const title = document.getElementById('movie-title').value.trim();
        const description = document.getElementById('movie-description').value.trim();

        if (!title || !description || !this.currentFile) {
            this.showNotification('Please fill all fields and select a file', 'error');
            return;
        }

        const uploadBtn = document.getElementById('upload-btn');
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

        await this.uploadMovie({ title, description }, this.currentFile);

        uploadBtn.disabled = false;
        uploadBtn.innerHTML = 'Upload Movie';
    }

    cancelUpload() {
        this.currentFile = null;
        document.getElementById('upload-area').style.display = 'block';
        document.getElementById('movie-form').style.display = 'none';
        document.getElementById('upload-progress').style.display = 'none';
        document.getElementById('movie-form').reset();
    }

    navigateToSection(sectionName) {
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        document.querySelector(`.nav-link[href="#${sectionName}"]`)?.classList.add('active');
        document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
        document.getElementById(sectionName).classList.add('active');
    }

    filterMovies(searchTerm) {
        const filtered = this.movies.filter(movie =>
            movie.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            movie.description.toLowerCase().includes(searchTerm.toLowerCase())
        );
        const grid = document.getElementById('movies-grid');
        if (filtered.length === 0) {
            grid.innerHTML = '<p class="text-center text-muted">No movies found matching your search.</p>';
            return;
        }
        grid.innerHTML = filtered.map(movie => `
            <div class="movie-card">
                <div class="movie-poster">
                    ${movie.thumbnailURL ? `<img src="${movie.thumbnailURL}" alt="${this.escapeHtml(movie.title)}" />` : `<i class="fas fa-film fa-3x"></i>`}
                </div>
                <div class="movie-info">
                    <h3 class="movie-title">${this.escapeHtml(movie.title)}</h3>
                    <p class="movie-description">${this.escapeHtml(movie.description)}</p>
                    <div class="movie-meta">
                        <span>${this.formatFileSize(movie.fileSize)}</span>
                        <span>${this.formatDate(movie.createdAt)}</span>
                    </div>
                    <button onclick="app.downloadMovie('${movie.id}')" 
                            class="btn btn-primary btn-block"
                            ${!this.currentUser ? 'disabled' : ''}>
                        <i class="fas fa-download"></i> 
                        ${this.currentUser ? 'Download' : 'Login to Download'}
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Auth Modals
    setupAuthModals() {
        const loginModal = document.getElementById('login-modal');
        const registerModal = document.getElementById('register-modal');
        document.getElementById('login-btn')?.addEventListener('click', () => this.showLoginModal());
        document.getElementById('show-register').addEventListener('click', e => { e.preventDefault(); this.showRegisterModal(); });
        document.getElementById('show-login').addEventListener('click', e => { e.preventDefault(); this.showLoginModal(); });

        document.getElementById('login-form').addEventListener('submit', e => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            this.login(email, password);
        });

        document.getElementById('register-form').addEventListener('submit', e => {
            e.preventDefault();
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            const confirm = document.getElementById('register-confirm').value;
            this.register(email, password, confirm);
        });

        document.querySelectorAll('.close').forEach(btn => btn.addEventListener('click', () => this.hideAuthModals()));
        [loginModal, registerModal].forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) this.hideAuthModals(); }));
    }

    showLoginModal() { document.getElementById('login-modal').style.display = 'block'; document.getElementById('register-modal').style.display = 'none'; }
    showRegisterModal() { document.getElementById('register-modal').style.display = 'block'; document.getElementById('login-modal').style.display = 'none'; }
    hideAuthModals() { document.getElementById('login-modal').style.display = 'none'; document.getElementById('register-modal').style.display = 'none'; document.getElementById('login-form').reset(); document.getElementById('register-form').reset(); }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `<div class="notification-content"><i class="fas fa-${type === 'success' ? 'check' : 'exclamation'}-circle"></i><span>${message}</span></div>`;
        notification.style.cssText = `position: fixed; top:100px; right:20px; background: ${type === 'success' ? 'var(--success-color)' : 'var(--error-color)'}; color:white; padding:1rem 1.5rem; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:3000; animation: slideInRight 0.3s ease;`;
        document.body.appendChild(notification);
        setTimeout(() => { notification.style.animation = 'slideOutRight 0.3s ease'; setTimeout(() => document.body.removeChild(notification), 300); }, 5000);
    }

    escapeHtml(unsafe) { if (!unsafe) return ''; return unsafe.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
    formatFileSize(bytes) { if (!bytes) return '0 Bytes'; const k=1024; const sizes=['Bytes','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(k)); return parseFloat((bytes/Math.pow(k,i)).toFixed(2))+' '+sizes[i]; }
    formatDate(timestamp) { if (!timestamp) return 'Unknown date'; const date = timestamp.toDate(); return date.toLocaleDateString(); }
}

// Notification CSS
const notificationStyles = `
@keyframes slideInRight { from { transform: translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }
@keyframes slideOutRight { from { transform: translateX(0); opacity:1; } to { transform: translateX(100%); opacity:0; } }
.notification-content { display:flex; align-items:center; gap:0.5rem; }
`;
const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);

const app = new MovieApp();
