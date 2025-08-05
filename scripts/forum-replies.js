// PART 1: Firebase init + loadPosts
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  doc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDH-nVvGkdaheH7pvRHH0M9TbW2f98lMGQ",
  authDomain: "kriptiek-c9ea2.firebaseapp.com",
  projectId: "kriptiek-c9ea2",
  storageBucket: "kriptiek-c9ea2.appspot.com",
  messagingSenderId: "620450620939",
  appId: "1:620450620939:web:e93a18ac23b53b33db890e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const userRegistered = localStorage.getItem('userRegistered') === 'true';
document.getElementById('new-post').style.display = userRegistered ? 'block' : 'none';

async function loadPosts() {
  const postsContainer = document.getElementById('forumPosts');
  postsContainer.innerHTML = '';
  const q = query(collection(db, 'forumPosts'), orderBy('timestamp', 'desc'));
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    const post = docSnap.data();
    const postId = docSnap.id;
    const div = document.createElement('div');
    div.className = 'mb-6 p-4 border rounded bg-white shadow';
    div.innerHTML = `
      <h3 class="text-lg font-bold text-gray-800 mb-1">${post.title}</h3>
      <p class="text-gray-700 whitespace-pre-line mb-2">${post.content}</p>
      <p class="text-xs text-gray-500 mb-2">Geplaas deur ${post.userName} | ${post.timestamp?.toDate().toLocaleString() || 'nou'}</p>
      <button class="text-blue-600 text-sm underline reply-btn" data-id="${postId}">Reageer</button>
      <div class="reply-box hidden mt-2">
        <textarea rows="2" placeholder="Jou antwoord" class="w-full p-2 border rounded mb-1"></textarea>
        <button class="submit-reply bg-gray-700 text-white px-2 py-1 rounded text-sm">Plaas antwoord</button>
      </div>
      <div class="replies mt-3 pl-3 border-l-2 border-gray-300">
        ${(post.replies || []).map(r => `
          <p class='text-sm text-gray-800 mb-1'><strong>${r.userName}</strong>: ${r.text}</p>
        `).join('')}
      </div>
    `;
    postsContainer.appendChild(div);
  });

  attachReplyListeners();
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  doc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDH-nVvGkdaheH7pvRHH0M9TbW2f98lMGQ",
  authDomain: "kriptiek-c9ea2.firebaseapp.com",
  projectId: "kriptiek-c9ea2",
  storageBucket: "kriptiek-c9ea2.appspot.com",
  messagingSenderId: "620450620939",
  appId: "1:620450620939:web:e93a18ac23b53b33db890e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const userRegistered = localStorage.getItem('userRegistered') === 'true';
document.getElementById('new-post').style.display = userRegistered ? 'block' : 'none';

async function loadPosts() {
  const postsContainer = document.getElementById('forumPosts');
  postsContainer.innerHTML = '';
  const q = query(collection(db, 'forumPosts'), orderBy('timestamp', 'desc'));
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    const post = docSnap.data();
    const postId = docSnap.id;
    const replies = post.replies || [];

    const div = document.createElement('div');
    div.className = 'mb-6 p-4 border rounded bg-white shadow';

    div.innerHTML = `
      <h3 class="text-lg font-bold text-gray-800 mb-1">${post.title}</h3>
      <p class="text-gray-700 whitespace-pre-line mb-2">${post.content}</p>
      <p class="text-xs text-gray-500">Geplaas deur ${post.userName} | ${post.timestamp?.toDate().toLocaleString() || 'nou'}</p>
      <div id="replies-${postId}" class="mt-4 space-y-2"></div>
      <div class="mt-4">
        <textarea id="reply-${postId}" rows="2" placeholder="Jou antwoord..." class="w-full p-2 border rounded mb-2"></textarea>
        <button onclick="submitReply('${postId}')" class="bg-gray-800 text-white px-3 py-1 rounded hover:bg-black transition">Antwoord</button>
      </div>
    `;

    const repliesDiv = div.querySelector(`#replies-${postId}`);
    replies.forEach(reply => {
      const p = document.createElement('p');
      p.className = 'text-sm text-gray-600 border-l-2 pl-2 border-gray-300';
      p.textContent = `${reply.userName}: ${reply.text}`;
      repliesDiv.appendChild(p);
    });

    postsContainer.appendChild(div);
  });
}

loadPosts();

